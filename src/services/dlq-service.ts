import type { PaymentRequest, ProcessedPayment } from '@/types'
import { PaymentProcessorRouter } from './payment-processor-router'

export class DLQService {
  private dlq: Array<{ 
    payment: PaymentRequest; 
    requestedAt: string;
    resolve: (result: ProcessedPayment) => void;
    reject: (error: Error) => void;
    retryCount: number;
  }> = []
  private isProcessing = false
  private paymentRouter: PaymentProcessorRouter
  private readonly maxRetries = 3

  constructor(paymentRouter: PaymentProcessorRouter) {
    this.paymentRouter = paymentRouter
  }

  async enqueueWithPromise(payment: PaymentRequest, requestedAt: string): Promise<ProcessedPayment> {
    return new Promise((resolve, reject) => {
      this.dlq.push({ payment, requestedAt, resolve, reject, retryCount: 0 })

      // Event-driven trigger - non-blocking
      if (!this.isProcessing) {
        setImmediate(() => this.processDLQ())
      }
    })
  }

  private async processDLQ() {
    this.isProcessing = true

    while (this.dlq.length > 0) {
      const item = this.dlq.shift()!

      try {
        // SEMPRE tenta default primeiro
        const result = await this.paymentRouter.makePaymentRequest(
          item.payment,
          item.requestedAt,
          this.paymentRouter.processors.get('default')!
        )

        item.resolve(result)
      } catch (error) {
        try {
          // Fallback como segunda opção
          const result = await this.paymentRouter.makePaymentRequest(
            item.payment,
            item.requestedAt,
            this.paymentRouter.processors.get('fallback')!
          )

          item.resolve(result)
        } catch (fallbackError) {
          // Ambos falharam: verifica se pode tentar novamente
          item.retryCount++
          
          if (item.retryCount < this.maxRetries) {
            // Recoloca na DLQ para retry
            this.dlq.push(item)
            // Small delay before retry
            await new Promise((resolve) => setTimeout(resolve, 100))
          } else {
            // Max retries atingido: força usar default como fallback
            const fallbackResult: ProcessedPayment = {
              correlationId: item.payment.correlationId,
              amount: item.payment.amount,
              processor: 'default',
              requestedAt: item.requestedAt,
            }
            item.resolve(fallbackResult)
          }
        }
      }
    }

    this.isProcessing = false
  }
}