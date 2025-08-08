import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentProcessor,
  PaymentProcessorRequest,
  ProcessorType,
} from '@/types'

export class PaymentProcessorRouter {
  private processors: Record<ProcessorType, PaymentProcessor>

  constructor() {
    this.processors = {
      default: { url: config.paymentProcessors.default.url, type: 'default' },
      fallback: {
        url: config.paymentProcessors.fallback.url,
        type: 'fallback',
      },
    }
  }

  private async makePaymentRequest(
    payment: PaymentRequest,
    requestedAt: string,
    processorUrl: string
  ): Promise<void> {
    const controller = new AbortController()
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.paymentRouter.requestTimeoutMs
    )
    const paymentData: PaymentProcessorRequest = {
      correlationId: payment.correlationId,
      amount: payment.amount,
      requestedAt,
    }

    const response = await fetch(`${processorUrl}/payments`, {
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
  }

  private delay = async (delay_ms = 1000) =>
    new Promise((resolve) => setTimeout(resolve, delay_ms))

  private fuckin_delay_ms = 75

  async processPaymentWithRetry(
    payment: PaymentRequest,
    requestedAt: string,
    processor = this.processors.default
  ): Promise<ProcessorType> {
    try {
      await this.makePaymentRequest(payment, requestedAt, processor.url)
      return processor.type
    } catch (error) {
      // change it for the final round maybe?
      // const alternativeProcessor =
      //   processor.type === 'default'
      //     ? this.processors.get('fallback')!
      //     : this.processors.get('default')!
      await this.delay(this.fuckin_delay_ms)
      this.fuckin_delay_ms += 75
      const alternativeProcessor = this.processors.default
      return this.processPaymentWithRetry(
        payment,
        requestedAt,
        alternativeProcessor
      )
    }
  }
}
