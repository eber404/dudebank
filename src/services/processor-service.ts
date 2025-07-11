import { config } from '@/config'
import type { PaymentProcessor, PaymentRequest, HealthCheckResponse } from '@/types'

export class ProcessorService {
  private processors: Map<string, PaymentProcessor>

  constructor() {
    this.processors = this.initializeProcessors()
    this.startHealthChecker()
  }

  private initializeProcessors(): Map<string, PaymentProcessor> {
    return new Map([
      ['default', {
        url: config.paymentProcessors.default.url,
        type: config.paymentProcessors.default.type,
        isHealthy: true,
        minResponseTime: 0,
        lastHealthCheck: 0
      }],
      ['fallback', {
        url: config.paymentProcessors.fallback.url,
        type: config.paymentProcessors.fallback.type,
        isHealthy: true,
        minResponseTime: 0,
        lastHealthCheck: 0
      }]
    ])
  }

  selectProcessor(): PaymentProcessor {
    const defaultProcessor = this.processors.get('default')!
    
    if (defaultProcessor.isHealthy) {
      return defaultProcessor
    }
    
    return this.processors.get('fallback')!
  }

  getProcessor(type: string): PaymentProcessor | undefined {
    return this.processors.get(type)
  }

  async fetchPaymentRequest(
    payment: PaymentRequest, 
    url: string, 
    requestedAt: string
  ): Promise<Response> {
    return fetch(`${url}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correlationId: payment.correlationId,
        amount: payment.amount,
        requestedAt
      }),
      signal: AbortSignal.timeout(config.processing.requestTimeoutMs)
    })
  }

  private startHealthChecker(): void {
    setInterval(async () => {
      for (const [, processor] of this.processors) {
        await this.checkProcessorHealth(processor)
      }
    }, config.processing.healthCheckIntervalMs)
  }

  private async checkProcessorHealth(processor: PaymentProcessor): Promise<void> {
    const now = Date.now()
    
    if (now - processor.lastHealthCheck <= config.processing.healthCheckCooldownMs) return

    try {
      const response = await fetch(`${processor.url}/payments/service-health`, {
        signal: AbortSignal.timeout(config.processing.healthCheckTimeoutMs)
      })

      if (response.ok) {
        const health = await response.json() as HealthCheckResponse
        processor.isHealthy = !health.failing
        processor.minResponseTime = health.minResponseTime
      } else {
        processor.isHealthy = false
      }
      
      processor.lastHealthCheck = now
    } catch (error) {
      processor.isHealthy = false
      processor.lastHealthCheck = now
    }
  }
}