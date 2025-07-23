import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentProcessor,
  PaymentProcessorRequest,
  HealthCheckResponse,
  ProcessorType,
} from '@/types'

export class PaymentRouter {
  private processors: Map<ProcessorType, PaymentProcessor> = new Map()
  private optimalProcessor: PaymentProcessor

  constructor() {
    this.processors = new Map<ProcessorType, PaymentProcessor>([
      [
        'default',
        { url: config.paymentProcessors.default.url, type: 'default' },
      ],
      [
        'fallback',
        { url: config.paymentProcessors.fallback.url, type: 'fallback' },
      ],
    ])
    this.optimalProcessor = this.processors.get('default')!
  }

  private async makePaymentRequest(
    payment: PaymentRequest,
    requestedAt: string,
    processor?: PaymentProcessor
  ): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.paymentRouter.requestTimeoutMs
    )
    const currentProcessor = processor ?? this.optimalProcessor
    try {
      const paymentData: PaymentProcessorRequest = {
        correlationId: payment.correlationId,
        amount: payment.amount,
        requestedAt,
      }

      const response = await fetch(`${currentProcessor.url}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData),
        signal: controller.signal,
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

  async processPaymentWithRetry(
    payment: PaymentRequest,
    requestedAt: string
  ): Promise<{ response: Response; processor: PaymentProcessor }> {
    try {
      const processor = this.processors.get('default')!
      const result = await this.makePaymentRequest(
        payment,
        requestedAt,
        processor
      )
      return { response: result, processor }
    } catch (error) {
      console.log(`Default processor failed:`, error)

      try {
        const processor = this.processors.get('fallback')!
        const result = await this.makePaymentRequest(
          payment,
          requestedAt,
          processor
        )
        return { response: result, processor }
      } catch (fallbackError) {
        console.log(`Fallback processor failed:`, String(fallbackError))
        return await this.processPaymentWithRetry(payment, requestedAt)
      }
    }
  }
}
