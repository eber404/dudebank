import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentProcessor,
  PaymentProcessorRequest,
  ProcessorType,
} from '@/types'

export class PaymentProcessorRouter {
  private processors: Record<ProcessorType, PaymentProcessor>
  private connectionCache: Map<string, { agent: any; lastUsed: number }>

  constructor() {
    this.processors = {
      default: { url: config.paymentProcessors.default.url, type: 'default' },
      fallback: {
        url: config.paymentProcessors.fallback.url,
        type: 'fallback',
      },
    }
    this.connectionCache = new Map()

    setInterval(() => this.cleanupIdleConnections(), 10000) //10s
  }

  private cleanupIdleConnections() {
    const now = Date.now()
    const maxIdleTime = 90000 // 90s

    for (const [url, connection] of this.connectionCache.entries()) {
      if (now - connection.lastUsed > maxIdleTime) {
        this.connectionCache.delete(url)
      }
    }
  }

  private getOrCreateAgent(url: string) {
    const existing = this.connectionCache.get(url)
    if (existing) {
      existing.lastUsed = Date.now()
      return existing.agent
    }

    const agent = { keepalive: true }
    this.connectionCache.set(url, { agent, lastUsed: Date.now() })
    return agent
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

    this.getOrCreateAgent(processorUrl)

    const response = await fetch(`${processorUrl}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      keepalive: true,
      body: JSON.stringify(paymentData),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
  }

  async processPaymentWithRetry(
    payment: PaymentRequest,
    requestedAt: string,
    processor = this.processors.default,
    retryCount = 0
  ): Promise<ProcessorType> {
    try {
      await this.makePaymentRequest(payment, requestedAt, processor.url)
      return processor.type
    } catch (error) {
      if (retryCount >= config.paymentRouter.maxRetries) {
        throw error
      }

      return this.processPaymentWithRetry(
        payment,
        requestedAt,
        undefined,
        retryCount + 1
      )
    }
  }
}
