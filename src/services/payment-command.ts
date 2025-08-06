import { Mutex } from 'async-mutex'

import type { PaymentRequest, ProcessedPayment } from '@/types'
import { config } from '@/config'

import { PaymentProcessorRouter } from './payment-processor-router'
import { DatabaseClient } from './database-client'
import { Queue } from './queue-service'

export class PaymentCommand {
  private paymentRouter: PaymentProcessorRouter
  private db: DatabaseClient
  private queue: Queue<PaymentRequest>
  private mutex: Mutex

  constructor(queue: Queue<PaymentRequest>) {
    this.paymentRouter = new PaymentProcessorRouter()
    this.db = new DatabaseClient()
    this.queue = queue
    this.mutex = new Mutex()
  }

  async processPaymentBatch(
    payments: PaymentRequest[]
  ): Promise<ProcessedPayment[]> {
    const requestedAt = new Date().toISOString()

    const processedPayments = await Promise.all(
      payments.map(async (payment) => {
        const result = await this.paymentRouter.processPaymentWithRetry(
          payment,
          requestedAt
        )

        return {
          correlationId: payment.correlationId,
          amount: payment.amount,
          processor: result.processor,
          requestedAt,
        }
      })
    )

    console.log(`[PaymentCommand] Persisting batch of ${processedPayments.length} payments`)
    await this.db.persistPaymentsBatch(processedPayments)
    console.log(`[PaymentCommand] Successfully persisted ${processedPayments.length} payments`)

    return processedPayments
  }

  async processPayments() {
    try {
      await this.mutex.runExclusive(async () => {
        let remaining = this.queue.size
        while (remaining > 0) {
          const batch: PaymentRequest[] = []
          const batchSize = Math.min(config.paymentWorker.batchSize, remaining)
          for (let i = 0; i < batchSize; i++) {
            const item = this.queue.dequeue()
            if (item) batch.push(item)
          }
          if (batch.length === 0) break
          await this.processPaymentBatch(batch)
          remaining -= batch.length
        }
      })
    } catch (err) {
      console.log(`[payment-command] processing error`, err)
    }
  }

  enqueue(input: PaymentRequest) {
    console.log(`[PaymentCommand] Enqueueing payment: ${input.correlationId}`)
    this.queue.enqueue(input)
    console.log(`[PaymentCommand] Queue size: ${this.queue.size}`)
    if (this.mutex.isLocked()) {
      console.log(`[PaymentCommand] Mutex locked, payment will be processed later`)
      return
    }
    console.log(`[PaymentCommand] Starting payment processing`)
    void this.processPayments()
  }

  async purgeAll(): Promise<void> {
    await this.db.purgeDatabase()
    console.log('Complete purge successful')
  }
}
