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
  private processorHealth: ProcessorHealthStatus = new Map([
    ['default', { failing: false, minResponseTime: 0, lastChecked: Date.now() }],
    ['fallback', { failing: false, minResponseTime: 9999, lastChecked: Date.now() }]
  ])
  private healthCheckInterval: NodeJS.Timeout | null = null
  private redisHealthCheckInterval: NodeJS.Timeout | null = null
  private redisService = new RedisService()
  private processorHealthCallbacks: Set<() => void> = new Set()

  constructor() {
    if (config.isMainInstance) {
      this.startHealthChecker()
    }
    this.startRedisHealthChecker()
    this.setupProcessorHealthListener()
  }

  private startHealthChecker(): void {
    this.performHealthChecks()
    this.healthCheckInterval = setInterval(async () => this.performHealthChecks(), config.paymentRouter.healthCheckIntervalMs)
  }

  private startRedisHealthChecker(): void {
    this.fetchHealthFromRedis()
    this.redisHealthCheckInterval = setInterval(() => this.fetchHealthFromRedis(), config.paymentRouter.redisHealthCheckIntervalMs)
  }

  private setupProcessorHealthListener(): void {
    this.processorHealthCallbacks.add(() => {
      this.rankOptimalProcessor()
    })
  }

  private async fetchHealthFromRedis(): Promise<void> {
    try {
      const [defaultHealth, fallbackHealth] = await Promise.all([
        this.redisService.getProcessorHealth('default'),
        this.redisService.getProcessorHealth('fallback')
      ])


      if (defaultHealth) {
        this.processorHealth.set('default', defaultHealth)
        this.notifyProcessorHealthChange()
      }

      if (fallbackHealth) {
        this.processorHealth.set('fallback', fallbackHealth)
        this.notifyProcessorHealthChange()
      }

    } catch (error) {
      console.error('Failed to fetch processor health from Redis:', error)
    }
  }


  private async performHealthChecks(): Promise<void> {
    const healthCheckPromises = Array.from(this.processors.values()).map(processor => this.getProcessorHealth(processor))
    const healthStatuses = await Promise.all(healthCheckPromises)

    // Update local health status
    healthStatuses.forEach(status => {
      status.forEach((health, type) => {
        this.processorHealth.set(type, health)
      })
    })

    // Persist to Redis
    await Promise.all(healthStatuses.flatMap(status => Array.from(status.entries()).map(([type, health]) => this.redisService.setProcessorHealth(type, health))))

    this.notifyProcessorHealthChange()
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
          minResponseTime: config.paymentRouter.healthCheckTimeoutMs,
          lastChecked: Date.now()
        }]
      ])
    }
  }

  private rankOptimalProcessor() {
    const defaultHealth = this.processorHealth.get('default') as ProcessorHealth
    const fallbackHealth = this.processorHealth.get('fallback') as ProcessorHealth

    if (defaultHealth.failing && !fallbackHealth.failing) {
      this.optimalProcessor = this.processors.get('fallback')!
      return
    }

    if (!defaultHealth.failing && fallbackHealth.failing
      || defaultHealth.failing && fallbackHealth.failing
    ) {
      this.optimalProcessor = this.processors.get('default')!
      return
    }

    const bestProcessor = fallbackHealth.minResponseTime < (defaultHealth.minResponseTime / config.paymentRouter.fallbackSpeedAdvantageThreshold)
      ? this.processors.get('fallback')!
      : this.processors.get('default')!

    this.optimalProcessor = bestProcessor
  }

  private getAlternativeProcessor(processor?: PaymentProcessor): PaymentProcessor {
    const currentProcessor = processor || this.optimalProcessor
    return currentProcessor.type === 'default'
      ? this.processors.get('fallback')!
      : this.processors.get('default')!
  }

  private async makePaymentRequest(
    payment: PaymentRequest,
    requestedAt: string,
    processor?: PaymentProcessor
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.paymentRouter.requestTimeoutMs)
    const currentProcessor = processor || this.optimalProcessor
    try {
      const startTime = Date.now()
      const paymentData: PaymentProcessorRequest = {
        correlationId: payment.correlationId,
        amount: payment.amount,
        requestedAt: requestedAt
      }

      const response = await fetch(`${currentProcessor.url}/payments`, {
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

      const responseTime = Date.now() - startTime

      const healthData = {
        failing: false,
        minResponseTime: responseTime,
        lastChecked: Date.now()
      }

      this.processorHealth.set(currentProcessor.type, healthData)
      await this.redisService.setProcessorHealth(currentProcessor.type, healthData)
      this.notifyProcessorHealthChange()

      return response
    } catch (error) {

      clearTimeout(timeoutId)

      const failureHealthData = {
        failing: true,
        minResponseTime: Infinity,
        lastChecked: Date.now()
      }

      this.processorHealth.set(currentProcessor.type, failureHealthData)
      await this.redisService.setProcessorHealth(currentProcessor.type, failureHealthData)

      throw error
    }
  }

  async processPaymentWithRetry(payment: PaymentRequest, requestedAt: string): Promise<{ response: Response; processor: PaymentProcessor }> {
    const primaryProcessor = this.optimalProcessor
    try {
      const result = await this.makePaymentRequest(payment, requestedAt)
      return { response: result, processor: primaryProcessor }
    } catch (error) {
      console.log(`Primary processor ${primaryProcessor.type} failed:`, error)
      const fallbackProcessor = this.getAlternativeProcessor(primaryProcessor)
      try {
        const result = await this.makePaymentRequest(payment, requestedAt, fallbackProcessor)
        return { response: result, processor: fallbackProcessor }
      } catch (fallbackError) {
        console.log(`Fallback processor ${fallbackProcessor.type} failed:`, String(fallbackError))
        return await this.raceProcessors(payment, requestedAt)
      }
    }
  }

  private async raceProcessors(payment: PaymentRequest, requestedAt: string): Promise<{ response: Response; processor: PaymentProcessor }> {
    const processors = Array.from(this.processors.values())

    while (true) {
      const promises = processors.map((processor) =>
        this.makePaymentRequest(payment, requestedAt, processor)
          .then(response => ({ response, processor }))
          .catch(error => ({ error, processor }))
      )

      const result = await Promise.race(promises)

      if ('response' in result) {
        return { response: result.response, processor: result.processor }
      }

      console.log('Race failed, retrying...')
    }
  }

  private notifyProcessorHealthChange(): void {
    this.processorHealthCallbacks.forEach(callback => callback())
  }

  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
    if (this.redisHealthCheckInterval) {
      clearInterval(this.redisHealthCheckInterval)
      this.redisHealthCheckInterval = null
    }
  }
}