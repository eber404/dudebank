import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentProcessor,
  PaymentProcessorRequest,
  ProcessorType,
  ProcessedPayment,
} from '@/types'

export class PaymentProcessorRouter {
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
  ): Promise<ProcessedPayment> {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.paymentRouter.requestTimeoutMs
    )
    const currentProcessor = processor ?? this.optimalProcessor
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

    const data = (await response.json()) as PaymentProcessorRequest

    return {
      amount: data.amount,
      correlationId: data.correlationId,
      processor: currentProcessor.type,
      requestedAt: data.requestedAt,
    }
  }

  private delay = async (delay_ms = 1000) =>
    new Promise((resolve) => setTimeout(resolve, delay_ms))

  private fuckin_delay_ms = 75

  async processPaymentWithRetry(
    payment: PaymentRequest,
    requestedAt: string,
    processor = this.processors.get('default')!
  ): Promise<ProcessedPayment> {
    try {
      const response = await this.makePaymentRequest(
        payment,
        requestedAt,
        processor
      )
      return {
        amount: response.amount,
        correlationId: response.correlationId,
        processor: response.processor,
        requestedAt: response.requestedAt,
      }
    } catch (error) {
      // const alternativeProcessor =
      //   processor.type === 'default'
      //     ? this.processors.get('fallback')!
      //     : this.processors.get('default')!
      await this.delay(this.fuckin_delay_ms)
      this.fuckin_delay_ms += 75
      const alternativeProcessor = this.processors.get('default')!

      return this.processPaymentWithRetry(
        payment,
        requestedAt,
        alternativeProcessor
      )
    }
  }
}
