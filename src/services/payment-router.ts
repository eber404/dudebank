import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentProcessor,
  PaymentProcessorRequest,
  HealthCheckResponse,
  ProcessorType
} from '@/types'

export class PaymentRouter {
  private processors: Map<ProcessorType, PaymentProcessor> = new Map()
  private optimalProcessor: PaymentProcessor
  private healthCheckInterval: NodeJS.Timeout | null = null
  private isHealthCheckActive: boolean = false

  constructor() {
    this.processors = new Map<ProcessorType, PaymentProcessor>([
      ['default', { url: config.paymentProcessors.default.url, type: 'default' }],
      ['fallback', { url: config.paymentProcessors.fallback.url, type: 'fallback' }]
    ])
    this.optimalProcessor = this.processors.get('default')!
  }

  private startHealthChecker(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks()
    }, config.paymentRouter.healthCheckIntervalMs)
  }

  private async performHealthChecks(): Promise<void> {
    const defaultProcessor = this.processors.get('default')!
    const isDefaultOnline = await this.isProcessorOnline(defaultProcessor)
    
    if (isDefaultOnline && this.optimalProcessor === this.processors.get('fallback')) {
      this.optimalProcessor = this.processors.get('default')!
      console.log('Switched back to default processor - it\'s online again')
    }
  }

  private async isProcessorOnline(processor: PaymentProcessor): Promise<boolean> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.paymentRouter.healthCheckTimeoutMs)

    try {
      const response = await fetch(`${processor.url}/payments/service-health`, {
        method: 'GET',
        signal: controller.signal
      })

      clearTimeout(timeoutId)
      return response.ok
    } catch (error) {
      clearTimeout(timeoutId)
      return false
    }
  }

  private async makePaymentRequest(
    payment: PaymentRequest,
    requestedAt: string,
    processor?: PaymentProcessor
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), config.paymentRouter.requestTimeoutMs)
    const currentProcessor = processor ?? this.optimalProcessor
    try {
      const paymentData: PaymentProcessorRequest = {
        correlationId: payment.correlationId,
        amount: payment.amount,
        requestedAt
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

      return response
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  private startHealthCheckerIfNotActive(): void {
    if (!this.isHealthCheckActive && config.isMainInstance) {
      this.isHealthCheckActive = true
      this.performHealthChecks()
      this.startHealthChecker()
    }
  }

  async processPaymentWithRetry(payment: PaymentRequest, requestedAt: string): Promise<{ response: Response; processor: PaymentProcessor }> {
    try {
      const result = await this.makePaymentRequest(payment, requestedAt)
      return { response: result, processor: this.processors.get('default')! }
    } catch (error) {
      console.log(`Default processor failed:`, error)

      this.startHealthCheckerIfNotActive()

      try {
        const result = await this.makePaymentRequest(payment, requestedAt, this.processors.get('fallback')!)
        return { response: result, processor: this.processors.get('fallback')! }
      } catch (fallbackError) {
        console.log(`Fallback processor failed:`, String(fallbackError))
        return await this.raceProcessors(payment, requestedAt)
      }
    }

  }

  private async raceProcessors(payment: PaymentRequest, requestedAt: string): Promise<{ response: Response; processor: PaymentProcessor }> {
    const startTime = Date.now()
    const timeoutMs = config.paymentRouter.raceProcessorsTimeoutMs

    while (Date.now() - startTime < timeoutMs) {
      const processorArray = Array.from(this.processors.values())

      const promises = processorArray.map((processor) => {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), config.paymentRouter.requestTimeoutMs)

        return fetch(`${processor.url}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            correlationId: payment.correlationId,
            amount: payment.amount,
            requestedAt
          }),
          signal: controller.signal
        })
          .then(response => {
            clearTimeout(timeoutId)
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            return { response, processor }
          })
          .catch(error => {
            clearTimeout(timeoutId)
            return { error, processor }
          })
      })

      try {
        const results = await Promise.allSettled(promises)

        for (const result of results) {
          if (result.status === 'fulfilled' && 'response' in result.value) {
            this.optimalProcessor = result.value.processor
            return { response: result.value.response, processor: result.value.processor }
          }
        }

        console.log('All processors failed in this race iteration, retrying...')
      } catch (error) {
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
  }
}