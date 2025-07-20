import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentProcessor,
  PaymentProcessorRequest,
  HealthCheckResponse,
  ProcessorType,
  ProcessorHealthStatus,
  ProcessorHealth
} from '@/types'
import { RedisService } from './redis-service'

export class PaymentRouter {
  private processors: Map<ProcessorType, PaymentProcessor> = new Map<ProcessorType, PaymentProcessor>([
    [
      'default',
      {
        url: config.paymentProcessors.default.url,
        type: config.paymentProcessors.default.type
      }
    ],
    [
      'fallback',
      {
        url: config.paymentProcessors.fallback.url,
        type: config.paymentProcessors.fallback.type
      }
    ]
  ])
  private optimalProcessor: PaymentProcessor = this.processors.get('default')!
  private healthCheckInterval: NodeJS.Timeout | null = null
  private optimalProcessorCheckInterval: NodeJS.Timeout | null = null
  private redisService = new RedisService()

  constructor() {
    if (config.isMainInstance) {
      this.startHealthChecker()
    }
    this.startOptimalProcessorChecker()
  }

  private startHealthChecker(): void {
    this.performHealthChecks()
    this.healthCheckInterval = setInterval(async () => this.performHealthChecks(), config.paymentRouter.healthCheckIntervalMs)
  }

  async startOptimalProcessorChecker(): Promise<void> {
    this.optimalProcessorCheckInterval = setInterval(() => this.setOptimalProcessor(), config.paymentRouter.optimalProcessorCheckIntervalMs)
  }

  async setOptimalProcessor(): Promise<void> {
    const optimalProcessorType = await this.redisService.getOptimalProcessor()
    if (!optimalProcessorType) {
      this.optimalProcessor = this.processors.get('default')!
      return
    }
    this.optimalProcessor = this.processors.get(optimalProcessorType) || this.optimalProcessor
  }

  private async performHealthChecks(): Promise<void> {
    const healthCheckPromises = Array.from(this.processors.values()).map(processor => this.getProcessorHealth(processor))
    const healthStatuses = await Promise.all(healthCheckPromises)
    const optimalProcessor = this.rankOptimalProcessor(healthStatuses)
    await this.redisService.setOptimalProcessor(optimalProcessor.type)
  }

  private async getProcessorHealth(processor: PaymentProcessor): Promise<ProcessorHealthStatus> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.paymentRouter.healthCheckTimeoutMs)

    try {
      const response = await fetch(`${processor.url}/payments/service-health`, {
        method: 'GET',
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const res = await response.json() as HealthCheckResponse

      return new Map([
        [processor.type, {
          failing: res.failing,
          minResponseTime: res.minResponseTime,
          lastChecked: Date.now()
        }]
      ])
    } catch (error) {
      clearTimeout(timeoutId)
      return new Map([
        [processor.type, {
          failing: true,
          minResponseTime: Infinity,
          lastChecked: Date.now()
        }]
      ])
    }
  }

  private rankOptimalProcessor(healthStatuses: ProcessorHealthStatus[]): PaymentProcessor {
    const defaultHealth = healthStatuses.find(status => status.has('default'))?.get('default') as ProcessorHealth
    const fallbackHealth = healthStatuses.find(status => status.has('fallback'))?.get('fallback') as ProcessorHealth
    const speedAdvantageThreshold = config.paymentRouter.fallbackSpeedAdvantageThreshold
    const fallbackSpeedAdvantage = (defaultHealth.minResponseTime - fallbackHealth.minResponseTime) / defaultHealth.minResponseTime

    if (fallbackSpeedAdvantage > speedAdvantageThreshold) {
      return {
        url: this.processors.get('fallback')!.url,
        type: 'fallback'
      }
    }

    return {
      url: this.processors.get('default')!.url,
      type: 'default'
    }
  }

  private getAlternativeProcessor(processor: PaymentProcessor): PaymentProcessor {
    return processor.type === 'default'
      ? this.processors.get('fallback')!
      : this.processors.get('default')!
  }

  private async makePaymentRequest(
    processor: PaymentProcessor,
    payment: PaymentRequest,
    requestedAt: string
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.paymentRouter.requestTimeoutMs)

    try {
      const paymentData: PaymentProcessorRequest = {
        correlationId: payment.correlationId,
        amount: payment.amount,
        requestedAt: requestedAt || new Date().toISOString()
      }

      const response = await fetch(`${processor.url}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(paymentData),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return response
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  async processPaymentWithRetry(payment: PaymentRequest, requestedAt: string): Promise<{ response: Response; processor: PaymentProcessor }> {
    const processor = this.optimalProcessor
    try {
      const result = await this.makePaymentRequest(processor, payment, requestedAt)
      return { response: result, processor: processor }
    } catch (error) {
      console.log(`Primary processor ${processor.type} failed:`, error)
      const fallbackProcessor = this.getAlternativeProcessor(processor)
      try {
        const result = await this.makePaymentRequest(fallbackProcessor, payment, requestedAt)
        await this.redisService.setOptimalProcessor(fallbackProcessor.type)
        return { response: result, processor: fallbackProcessor }
      } catch (fallbackError) {
        console.log(`Fallback processor ${fallbackProcessor.type} failed:`, String(fallbackError))
        return await this.raceProcessors(payment, requestedAt)
      }
    }
  }

  private async raceProcessors(payment: PaymentRequest, requestedAt: string): Promise<{ response: Response; processor: PaymentProcessor }> {
    const startTime = Date.now()
    const timeoutMs = config.paymentRouter.raceProcessorsTimeoutMs

    while (Date.now() - startTime < timeoutMs) {
      const processors = Array.from(this.processors.values())
      const controllers = processors.map(() => new AbortController())

      const promises = processors.map((processor) =>
        this.makePaymentRequest(processor, payment, requestedAt)
          .then(response => ({ response, processor }))
          .catch(error => ({ error, processor }))
      )

      try {
        const results = await Promise.allSettled(promises)
        controllers.forEach(controller => controller.abort())

        for (const result of results) {
          if (result.status === 'fulfilled' && 'response' in result.value) {
            await this.redisService.setOptimalProcessor(result.value.processor.type)
            return { response: result.value.response, processor: result.value.processor }
          }
        }

        console.log('All processors failed in this race iteration, retrying...')
      } catch (error) {
        controllers.forEach(controller => controller.abort())
        console.log('Race iteration failed:', error)
      }
    }

    throw new Error(`All processors failed after ${timeoutMs}ms timeout`)
  }

  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    if (this.optimalProcessorCheckInterval) {
      clearInterval(this.optimalProcessorCheckInterval)
      this.optimalProcessorCheckInterval = null
    }
  }
}