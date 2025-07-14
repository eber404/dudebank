import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentProcessor,
  ProcessorHealth,
  ProcessorScore,
  PaymentProcessorRequest,
  HealthCheckResponse
} from '@/types'
import { CacheService } from './cache-service'

export class PaymentRouter {
  private processors: PaymentProcessor[]
  private cacheService: CacheService
  private healthCheckInterval: NodeJS.Timeout | null = null
  private lastHealthCheck: Map<string, number>

  constructor() {
    this.cacheService = new CacheService()
    this.lastHealthCheck = new Map()

    this.processors = [
      {
        url: config.paymentProcessors.default.url,
        type: config.paymentProcessors.default.type,
        isHealthy: false,
        minResponseTime: 0,
        lastHealthCheck: 0
      },
      {
        url: config.paymentProcessors.fallback.url,
        type: config.paymentProcessors.fallback.type,
        isHealthy: false,
        minResponseTime: 0,
        lastHealthCheck: 0
      }
    ]

    this.startHealthCheck()
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.performHealthChecks()
      } catch (error) {
        console.error('Health check failed:', error)
      }
    }, config.paymentRouter.healthCheckIntervalMs)
  }

  private async performHealthChecks(): Promise<void> {
    const healthCheckPromises = this.processors.map(processor => this.checkProcessorHealth(processor))
    await Promise.all(healthCheckPromises)

    const optimalProcessor = this.selectOptimalProcessor()
    if (optimalProcessor) {
      await this.cacheService.setOptimalProcessor(optimalProcessor.type)
    }
  }

  private async checkProcessorHealth(processor: PaymentProcessor): Promise<void> {
    const now = Date.now()
    const lastCheck = this.lastHealthCheck.get(processor.type) || 0

    if (now - lastCheck < config.paymentRouter.healthCheckIntervalMs) {
      return
    }

    this.lastHealthCheck.set(processor.type, now)

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

      processor.isHealthy = !health.failing
      processor.minResponseTime = health.minResponseTime
      processor.lastHealthCheck = now

      const processorHealth: ProcessorHealth = {
        failing: health.failing,
        minResponseTime: health.minResponseTime,
        lastChecked: now
      }

      await this.cacheService.setProcessorHealth(processor.type, processorHealth)
    } catch (error) {
      processor.isHealthy = false
      processor.minResponseTime = 9999
      processor.lastHealthCheck = now

      console.log(`Health check failed for ${processor.type}:`, error)
    }
  }

  private calculateProcessorScore(processor: PaymentProcessor): ProcessorScore {
    const weights = config.paymentRouter.processorScoreWeights

    if (!processor.isHealthy) {
      return { processor, score: 0, reasoning: 'Unhealthy' }
    }

    const feeScore = processor.type === 'default' ? 100 : 70
    const responseScore = Math.max(0, 100 - (processor.minResponseTime / 10))
    const availabilityScore = processor.isHealthy ? 100 : 0

    const finalScore = (feeScore * weights.fee) + (responseScore * weights.responseTime) + (availabilityScore * weights.availability)


    return {
      processor,
      score: finalScore,
      reasoning: `Fee: ${feeScore}, Response: ${responseScore}, Health: ${availabilityScore}`
    }
  }

  selectOptimalProcessor(): PaymentProcessor | null {
    const scores = this.processors.map(processor => this.calculateProcessorScore(processor))
    const validScores = scores.filter(score => score.score > 0)

    if (validScores.length === 0) {
      return null
    }

    const bestScore = validScores.reduce((prev, current) =>
      prev.score > current.score ? prev : current
    )

    return bestScore.processor
  }

  private async getOptimalProcessor(): Promise<PaymentProcessor> {
    const cachedType = await this.cacheService.getOptimalProcessor()

    if (cachedType) {
      const processor = this.processors.find(p => p.type === cachedType)
      if (processor && processor.isHealthy) {
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
    const controllers = this.processors.map(() => new AbortController())

    const promises = this.processors.map((processor, index) =>
      this.makePaymentRequest(processor, payment, controllers[index]!.signal)
        .then(response => ({ response, processor }))
    )

    try {
      const result = await Promise.race(promises)

      controllers.forEach(controller => controller.abort())

      await this.cacheService.setOptimalProcessor(result.processor.type)

      return result
    } catch (error) {
      controllers.forEach(controller => controller.abort())
      throw new Error('All processors failed')
    }
  }

  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }
  }
}