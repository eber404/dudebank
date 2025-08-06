import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentProcessor,
  PaymentProcessorRequest,
  ProcessorType,
  ProcessedPayment,
} from '@/types'
import { DLQService } from './dlq-service'

export class PaymentProcessorRouter {
  public processors: Map<ProcessorType, PaymentProcessor> = new Map()
  private optimalProcessor: PaymentProcessor
  private dlqService: DLQService

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
    this.dlqService = new DLQService(this)
  }

  public async makePaymentRequest(
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
        Connection: 'keep-alive',
        'Keep-Alive': 'timeout=5, max=100',
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


  async processPaymentWithRetry(
    payment: PaymentRequest,
    requestedAt: string
  ): Promise<ProcessedPayment> {
    // Tenta default primeiro
    try {
      return await this.makePaymentRequest(payment, requestedAt, this.processors.get('default')!)
    } catch (error) {
      // Tenta fallback
      try {
        return await this.makePaymentRequest(payment, requestedAt, this.processors.get('fallback')!)
      } catch (fallbackError) {
        // Ambos falharam: envia para DLQ e espera resultado
        return await this.dlqService.enqueueWithPromise(payment, requestedAt)
      }
    }
  }
}
