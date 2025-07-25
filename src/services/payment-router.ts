import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentProcessor,
  PaymentProcessorRequest,
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
    requestedAt: string,
    processor = this.processors.get('default')!
  ): Promise<{ response: Response; processor: PaymentProcessor }> {
    try {
      const response = await this.makePaymentRequest(
        payment,
        requestedAt,
        processor
      )
      return { response, processor }
    } catch (error) {
      const alternativeProcessor =
        processor.type === 'default'
          ? this.processors.get('fallback')!
          : this.processors.get('default')!

      // console.log(
      //   `${processor.type} processor failed. Retrying with ${alternativeProcessor.type}...`
      // )
      return this.processPaymentWithRetry(
        payment,
        requestedAt,
        alternativeProcessor
      )
    }
  }
}
