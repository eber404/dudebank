import { config } from '@/config'
import type { PaymentRequest, PaymentSummary, ProcessedPayment, ProcessorType } from '@/types'

import { PaymentRouter } from './payment-router'
import { MemoryDBClient } from './memorydb-client'

export class PaymentService {
  private paymentRouter: PaymentRouter
  private memoryDBClient: MemoryDBClient
  private paymentQueue: PaymentRequest[] = []
  private processing = false
  private totalProcessed = 0
  private totalReceived = 0

  constructor() {
    this.paymentRouter = new PaymentRouter()
    this.memoryDBClient = new MemoryDBClient()

    this.startPaymentProcessor()
  }

  private startPaymentProcessor(): void {
    setInterval(async () => {
      if (this.processing || !this.paymentQueue.length) return

      this.processing = true
      const batch = this.paymentQueue.splice(0, config.processing.batchSize)
      await this.processBatch(batch)
      this.processing = false
    }, config.processing.batchIntervalMs)
  }

  private async processBatch(payments: PaymentRequest[]): Promise<void> {
    const batchStartTime = Date.now()

    const promises = payments.map(payment => this.processPayment(payment))
    const results = await Promise.allSettled(promises)

    const successfulPayments: ProcessedPayment[] = []

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        successfulPayments.push(result.value.processedPayment)
      }
    }

    if (successfulPayments.length > 0) {
      const dbStartTime = Date.now()
      await this.memoryDBClient.persistPaymentsBatch(successfulPayments)
      const dbTime = Date.now() - dbStartTime

      const totalTime = Date.now() - batchStartTime
      this.totalProcessed += successfulPayments.length

      console.log(`Batch processed: ${successfulPayments.length}/${payments.length} payments | DB: ${dbTime}ms | Total: ${totalTime}ms | Queue: ${this.paymentQueue.length}`)
    }
  }

  private async processPayment(payment: PaymentRequest): Promise<{ processedPayment: ProcessedPayment; processorType: ProcessorType } | null> {
    try {
      const requestedAt = new Date().toISOString()
      const result = await this.paymentRouter.processPaymentWithRetry(payment, requestedAt)

      if (!result.response.ok) return null

      const processorType = result.processor.type

      const processedPayment = {
        correlationId: payment.correlationId,
        amount: payment.amount,
        processor: processorType,
        requestedAt,
        status: 'processed' as const
      }

      return { processedPayment, processorType }
    } catch (error) {
      console.error('Error processing payment:', error)
      return null
    }
  }

  async addPayment(payment: PaymentRequest): Promise<void> {
    this.paymentQueue.push(payment)
    this.totalReceived++
  }

  async getPaymentsSummary(from?: string, to?: string): Promise<PaymentSummary> {
    try {
      return await this.memoryDBClient.getDatabaseSummary(from, to)
    } catch (error) {
      console.error('Error getting payments summary:', error)
      return {
        default: { totalRequests: 0, totalAmount: 0 },
        fallback: { totalRequests: 0, totalAmount: 0 }
      }
    }
  }


  async purgeAll(): Promise<{ database: boolean; queue: boolean }> {
    const results = {
      database: false,
      queue: false
    }

    try {
      // Clear processing queue and reset stats
      this.paymentQueue = []
      this.totalProcessed = 0
      this.totalReceived = 0
      results.queue = true
      console.log('Payment queue and stats cleared')

      // Purge MemoryDB
      await this.memoryDBClient.purgeDatabase()
      results.database = true

      console.log('Complete purge successful')
      return results
    } catch (error) {
      console.error('Error during purge operation:', error)
      return results
    }
  }

}