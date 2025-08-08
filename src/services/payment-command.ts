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

  constructor(db: DatabaseClient) {
    this.db = db
    this.paymentRouter = new PaymentProcessorRouter()
    this.queue = new Queue<PaymentRequest>()
    this.mutex = new Mutex()
  }

  async processPaymentBatch(payments: PaymentRequest[]) {
    const requestedAt = new Date().toISOString()
    const processedPayments = await Promise.all(
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

    await this.db.persistPaymentsBatch(processedPayments)
  }

  private async listenPaymentQueue() {
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
      console.log(`[PaymentCommand] processing error`, err)
    }
  }

  enqueue(input: PaymentRequest) {
    this.queue.enqueue(input)
    if (this.mutex.isLocked()) return
    void this.listenPaymentQueue()
  }

  async purgeAll(): Promise<void> {
    await this.db.purgeDatabase()
    console.log('[PaymentCommand] purge successful')
  }
}
