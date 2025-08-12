import type { PaymentRequest, ProcessedPayment } from '@/types'
import { config } from '@/config'

import { PaymentProcessorRouter } from './payment-processor-router'
import { DatabaseClient } from './database-client'
import { Queue } from './queue-service'

export class PaymentCommand {
  private paymentRouter: PaymentProcessorRouter
  private db: DatabaseClient
  private queue: Queue<PaymentRequest>
  private isProcessing: boolean = false
  private processTimer: Timer | null = null

  constructor(db: DatabaseClient) {
    this.db = db
    this.paymentRouter = new PaymentProcessorRouter()
    this.queue = new Queue<PaymentRequest>()
  }

  private async processPaymentBatch(payments: PaymentRequest[]) {
    const requestedAt = new Date().toISOString()
    const results = await Promise.allSettled(
      payments.map(async (payment) => {
        const processor = await this.paymentRouter.processPaymentWithRetry(
          payment,
          requestedAt
        )

        return {
          correlationId: payment.correlationId,
          amount: payment.amount,
          processor,
          requestedAt,
        }
      })
    )

    const processedPayments: ProcessedPayment[] = []
    const failedPayments: PaymentRequest[] = []

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        processedPayments.push(result.value)
        return
      }
      const payment = payments[index]
      if (payment) {
        failedPayments.push(payment)
      }
    })

    if (processedPayments.length > 0) {
      await this.db.persistPaymentsBatch(processedPayments)
    }

    failedPayments.forEach((payment) => this.queue.enqueue(payment))
  }

  private async processQueueBatch() {
    if (this.isProcessing || !this.queue?.size) {
      return
    }

    this.stopProcessingTimer()
    this.isProcessing = true

    try {
      const batch: PaymentRequest[] = []
      const batchSize = Math.min(
        config.paymentWorker.batchSize,
        this.queue.size
      )

      for (let i = 0; i < batchSize; i++) {
        const item = this.queue.dequeue()
        if (!item) break
        batch.push(item)
      }

      if (batch.length > 0) {
        await this.processPaymentBatch(batch)
      }
    } catch (err) {
      console.log(`[PaymentCommand] processing error`, err)
    } finally {
      this.isProcessing = false
      if (this.queue.size) {
        this.startProcessingTimer()
      }
    }
  }

  private startProcessingTimer() {
    if (this.processTimer) return
    this.processTimer = setInterval(
      async () => this.processQueueBatch(),
      config.paymentWorker.processIntervalMs
    )
  }

  private stopProcessingTimer() {
    if (!this.processTimer) return
    clearInterval(this.processTimer)
    this.processTimer = null
  }

  enqueue(input: PaymentRequest) {
    this.queue.enqueue(input)
    
    // Só processar se não estiver processando
    if (!this.isProcessing) {
      void this.processQueueBatch()
    }
    
    this.startProcessingTimer()
  }

  async purgeAll(): Promise<void> {
    await this.db.purgeDatabase()
    console.log('[PaymentCommand] purge successful')
  }
}
