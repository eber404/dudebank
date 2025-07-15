import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentProcessor,
  ProcessorHealth,
  PaymentProcessorRequest,
  HealthCheckResponse
} from '@/types'
import { CacheService } from './cache-service'

export class PaymentRouter {
  private processors: PaymentProcessor[]
  private cacheService: CacheService
  private healthCheckInterval: NodeJS.Timeout | null = null
  private isLeader: boolean = false

  constructor() {
    this.cacheService = new CacheService()

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
      try {
        this.isLeader = await this.cacheService.manageHealthCheckLock(this.isLeader)

        if (this.isLeader) {
          await this.performHealthChecks()
        }
      } catch (error) {
        console.error('Health check failed:', error)
        this.isLeader = false
      }
    }, config.paymentRouter.healthCheckIntervalMs)
  }

  private async performHealthChecks(): Promise<void> {
    const healthCheckPromises = this.processors.map(processor => this.checkProcessorHealth(processor))
    await Promise.all(healthCheckPromises)

    const optimalProcessor = await this.selectOptimalProcessor()
    if (optimalProcessor) {
      await this.cacheService.setOptimalProcessor(optimalProcessor.type)
    }
  }

  private async checkProcessorHealth(processor: PaymentProcessor): Promise<void> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), config.paymentRouter.healthCheckTimeoutMs)

      const response = await fetch(`${processor.url}/payments/service-health`, {
        method: 'GET',
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const health = await response.json() as HealthCheckResponse

      const processorHealth: ProcessorHealth = {
        failing: health.failing,
        minResponseTime: health.minResponseTime,
        lastChecked: Date.now()
      }

      await this.cacheService.setProcessorHealth(processor.type, processorHealth)
    } catch (error) {
      const failedHealth: ProcessorHealth = {
        failing: true,
        minResponseTime: Infinity,
        lastChecked: Date.now()
      }

      await this.cacheService.setProcessorHealth(processor.type, failedHealth)
      console.log(`Health check failed for ${processor.type}:`, error)
    }
  }


  async selectOptimalProcessor(): Promise<PaymentProcessor | null> {
    const healthPromises = this.processors.map(async processor => ({
      processor,
      health: await this.cacheService.getProcessorHealth(processor.type)
    }))

    const processorsWithHealth = await Promise.all(healthPromises)
    const validProcessors = processorsWithHealth.filter(({ health }) => health && !health.failing)

    if (validProcessors.length === 0) {
      return null
    }

    const defaultProcessor = validProcessors.find(({ processor }) => processor.type === 'default')
    const fallbackProcessor = validProcessors.find(({ processor }) => processor.type === 'fallback')

    if (!defaultProcessor) {
      return fallbackProcessor?.processor || null
    }

    if (!fallbackProcessor) {
      return defaultProcessor.processor
    }

    const defaultResponseTime = defaultProcessor.health!.minResponseTime
    const fallbackResponseTime = fallbackProcessor.health!.minResponseTime
    const speedAdvantageThreshold = config.paymentRouter.fallbackSpeedAdvantageThreshold

    const fallbackSpeedAdvantage = (defaultResponseTime - fallbackResponseTime) / defaultResponseTime

    if (fallbackSpeedAdvantage > speedAdvantageThreshold) {
      return fallbackProcessor.processor
    }

    return defaultProcessor.processor
  }

  private async getOptimalProcessor(): Promise<PaymentProcessor> {
    const cachedType = await this.cacheService.getOptimalProcessor()

    if (cachedType) {
      const processor = this.processors.find(p => p.type === cachedType)
      if (processor) {
        const health = await this.cacheService.getProcessorHealth(processor.type)
        if (health && !health.failing) {
          return processor
        }
      }
    }

    const optimal = await this.selectOptimalProcessor()
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
    signal?: AbortSignal
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.paymentRouter.requestTimeoutMs)

    try {
      const paymentData: PaymentProcessorRequest = {
        correlationId: payment.correlationId,
        amount: payment.amount,
        requestedAt: new Date().toISOString()
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

  async processPaymentWithRetry(payment: PaymentRequest): Promise<{ response: Response; processor: PaymentProcessor }> {
    let primaryProcessor = await this.getOptimalProcessor()

    try {
      const result = await this.makePaymentRequest(primaryProcessor, payment)
      return { response: result, processor: primaryProcessor }
    } catch (error) {
      console.log(`Primary processor ${primaryProcessor.type} failed:`, error)

      const fallbackProcessor = this.getAlternativeProcessor(primaryProcessor)
      try {
        const result = await this.makePaymentRequest(fallbackProcessor, payment)

        await this.cacheService.setOptimalProcessor(fallbackProcessor.type)
        return { response: result, processor: fallbackProcessor }
      } catch (fallbackError) {
        console.log(`Fallback processor ${fallbackProcessor.type} failed:`, fallbackError)

        return await this.raceProcessors(payment)
      }
    }
  }

  private async raceProcessors(payment: PaymentRequest): Promise<{ response: Response; processor: PaymentProcessor }> {
    const startTime = Date.now()
    const timeoutMs = config.paymentRouter.raceProcessorsTimeoutMs

    while (Date.now() - startTime < timeoutMs) {
      const controllers = this.processors.map(() => new AbortController())

      const promises = this.processors.map((processor, index) =>
        this.makePaymentRequest(processor, payment, controllers[index]!.signal)
          .then(response => ({ response, processor }))
          .catch(error => ({ error, processor }))
      )

      try {
        const results = await Promise.allSettled(promises)
        controllers.forEach(controller => controller.abort())

        for (const result of results) {
          if (result.status === 'fulfilled' && 'response' in result.value) {
            await this.cacheService.setOptimalProcessor(result.value.processor.type)
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