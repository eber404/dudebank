import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentProcessor,
  PaymentProcessorRequest,
  HealthCheckResponse
} from '@/types'

export class PaymentRouter {
  private processors: PaymentProcessor[]
  private healthStatus: Map<string, { failing: boolean; minResponseTime: number; lastChecked: number }> = new Map()
  private healthCheckInterval: NodeJS.Timeout | null = null
  private optimalProcessor: string = 'default'

  constructor() {
    this.processors = [
      {
        url: config.paymentProcessors.default.url,
        type: config.paymentProcessors.default.type
      },
      {
        url: config.paymentProcessors.fallback.url,
        type: config.paymentProcessors.fallback.type
      }
    ]

    this.startHealthCheck()
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks()
    }, config.paymentRouter.healthCheckIntervalMs)

    // Initial health check
    this.performHealthChecks()
  }

  private async performHealthChecks(): Promise<void> {
    const healthCheckPromises = this.processors.map(processor => this.checkProcessorHealth(processor))
    await Promise.all(healthCheckPromises)

    const optimalProcessor = this.selectOptimalProcessor()
    if (optimalProcessor) {
      this.optimalProcessor = optimalProcessor.type
    }
  }

  private async checkProcessorHealth(processor: PaymentProcessor): Promise<void> {
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

      const health = await response.json() as HealthCheckResponse

      this.healthStatus.set(processor.type, {
        failing: false,
        minResponseTime: health.minResponseTime,
        lastChecked: Date.now()
      })
    } catch (error) {
      clearTimeout(timeoutId)

      this.healthStatus.set(processor.type, {
        failing: true,
        minResponseTime: Infinity,
        lastChecked: Date.now()
      })

      console.log(`Health check failed for ${processor.type}:`, error)
    }
  }

  private selectOptimalProcessor(): PaymentProcessor | null {
    const validProcessors = this.processors.filter(processor => {
      const health = this.healthStatus.get(processor.type)
      return health && !health.failing
    })

    if (validProcessors.length === 0) {
      return null
    }

    const defaultProcessor = validProcessors.find(p => p.type === 'default')
    const fallbackProcessor = validProcessors.find(p => p.type === 'fallback')

    if (!defaultProcessor) {
      return fallbackProcessor || null
    }

    if (!fallbackProcessor) {
      return defaultProcessor
    }

    const defaultHealth = this.healthStatus.get('default')!
    const fallbackHealth = this.healthStatus.get('fallback')!
    const speedAdvantageThreshold = config.paymentRouter.fallbackSpeedAdvantageThreshold

    const fallbackSpeedAdvantage = (defaultHealth.minResponseTime - fallbackHealth.minResponseTime) / defaultHealth.minResponseTime

    if (fallbackSpeedAdvantage > speedAdvantageThreshold) {
      return fallbackProcessor
    }

    return defaultProcessor
  }

  private getOptimalProcessor(): PaymentProcessor {
    const processor = this.processors.find(p => p.type === this.optimalProcessor)
    if (processor) {
      const health = this.healthStatus.get(processor.type)
      if (health && !health.failing) {
        return processor
      }
    }

    const optimal = this.selectOptimalProcessor()
    if (optimal) {
      return optimal
    }

    return this.processors[0]!
  }

  private getAlternativeProcessor(currentProcessor: PaymentProcessor): PaymentProcessor {
    const alternative = this.processors.find(p => p.type !== currentProcessor.type)
    return alternative || this.processors[0]!
  }

  private async makePaymentRequest(
    processor: PaymentProcessor,
    payment: PaymentRequest,
    signal?: AbortSignal,
    requestedAt?: string
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
        signal: signal || controller.signal
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

  async processPaymentWithRetry(payment: PaymentRequest, requestedAt?: string): Promise<{ response: Response; processor: PaymentProcessor }> {
    let primaryProcessor = this.getOptimalProcessor()

    try {
      const result = await this.makePaymentRequest(primaryProcessor, payment, undefined, requestedAt)
      return { response: result, processor: primaryProcessor }
    } catch (error) {
      console.log(`Primary processor ${primaryProcessor.type} failed:`, error)

      const fallbackProcessor = this.getAlternativeProcessor(primaryProcessor)
      try {
        const result = await this.makePaymentRequest(fallbackProcessor, payment, undefined, requestedAt)
        this.optimalProcessor = fallbackProcessor.type
        return { response: result, processor: fallbackProcessor }
      } catch (fallbackError) {
        console.log(`Fallback processor ${fallbackProcessor.type} failed:`, fallbackError)
        return await this.raceProcessors(payment, requestedAt)
      }
    }
  }

  private async raceProcessors(payment: PaymentRequest, requestedAt?: string): Promise<{ response: Response; processor: PaymentProcessor }> {
    const startTime = Date.now()
    const timeoutMs = config.paymentRouter.raceProcessorsTimeoutMs

    while (Date.now() - startTime < timeoutMs) {
      const controllers = this.processors.map(() => new AbortController())

      const promises = this.processors.map((processor, index) =>
        this.makePaymentRequest(processor, payment, controllers[index]!.signal, requestedAt)
          .then(response => ({ response, processor }))
          .catch(error => ({ error, processor }))
      )

      try {
        const results = await Promise.allSettled(promises)
        controllers.forEach(controller => controller.abort())

        for (const result of results) {
          if (result.status === 'fulfilled' && 'response' in result.value) {
            this.optimalProcessor = result.value.processor.type
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

}