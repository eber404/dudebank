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

    if (defaultHealth.failing && !fallbackHealth.failing) {
      return this.processors.get('fallback')!
    }

    if (!defaultHealth.failing && fallbackHealth.failing
      || defaultHealth.failing && fallbackHealth.failing
    ) {
      return this.processors.get('default')!
    }

    // Tratar casos de Infinity
    if (defaultHealth.minResponseTime === Infinity) {
      return this.processors.get('fallback')!
    }

    if (fallbackHealth.minResponseTime === Infinity) {
      return this.processors.get('default')!
    }

    // Cálculo de custo-benefício considerando taxas
    const defaultFee = config.paymentRouter.processorFees.default
    const fallbackFee = config.paymentRouter.processorFees.fallback

    // Para ser economicamente vantajoso, fallback deve compensar o custo extra com velocidade
    // Se fallback custa 3x mais (15% vs 5%), deve ser pelo menos 3x mais rápido
    const costMultiplier = fallbackFee / defaultFee // 3.0 para taxas atuais (15%/5%)
    const requiredSpeedAdvantage = costMultiplier - 1 // 2.0 (200% mais rápido)

    // Calcular vantagem de velocidade SEM Math.abs para preservar sinal
    // Positivo = fallback mais rápido, Negativo = fallback mais lento
    const fallbackSpeedAdvantage = (defaultHealth.minResponseTime - fallbackHealth.minResponseTime) / defaultHealth.minResponseTime

    const isEconomicallyViable = fallbackSpeedAdvantage >= requiredSpeedAdvantage
    const costDifference = ((fallbackFee - defaultFee) * 100).toFixed(1)

    console.log({
      defaultHealth: { ...defaultHealth, fee: `${(defaultFee * 100)}%` },
      fallbackHealth: { ...fallbackHealth, fee: `${(fallbackFee * 100)}%` },
      fallbackSpeedAdvantage: `${(fallbackSpeedAdvantage * 100).toFixed(1)}%`,
      requiredSpeedAdvantage: `${(requiredSpeedAdvantage * 100).toFixed(1)}%`,
      costDifference: `+${costDifference}%`,
      costMultiplier: `${costMultiplier.toFixed(1)}x`,
      isEconomicallyViable,
      decision: isEconomicallyViable ? 'Fallback (speed compensates cost)' : 'Default (better cost-benefit)'
    })

    if (!Number.isNaN(fallbackSpeedAdvantage)
      && Number.isFinite(fallbackSpeedAdvantage)
      && isEconomicallyViable
    ) {
      return this.processors.get('fallback')!
    }

    return this.processors.get('default')!
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