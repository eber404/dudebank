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
  private processTimer: Timer | null = null

  constructor(db: DatabaseClient) {
    this.db = db
    this.paymentRouter = new PaymentProcessorRouter()
    this.queue = new Queue<PaymentRequest>()
    this.mutex = new Mutex()
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
      } else {
        const payment = payments[index]
        if (payment) {
          failedPayments.push(payment)
          console.log(
            `[PaymentCommand] Payment failed, re-queueing:`,
            payment.correlationId
          )
        }
      }
    })

    if (processedPayments.length > 0) {
      await this.db.persistPaymentsBatch(processedPayments)
    }

    failedPayments.forEach((payment) => this.queue.enqueue(payment))
  }

  private async processQueueBatch() {
    if (this.mutex.isLocked()) {
      return
    }

    if (!this.queue) {
      this.stopProcessingTimer()
      return
    }

    try {
      await this.mutex.runExclusive(async () => {
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

        if (batch.length === 0) return

        await this.processPaymentBatch(batch)
      })
    } catch (err) {
      console.log(`[PaymentCommand] processing error`, err)
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
    if (this.queue.size >= config.paymentWorker.queueThreshold) {
      void this.processQueueBatch()
      this.startProcessingTimer()
    }
  }

  async purgeAll(): Promise<void> {
    await this.db.purgeDatabase()
    console.log('[PaymentCommand] purge successful')
  }
}
