import { config } from '@/config'
import type { PaymentRequest, PaymentSummary } from '@/types'

import { DatabaseService } from './database-service'
import { CacheService } from './cache-service'
import { PaymentRouter } from './payment-router'

export class PaymentService {
  private databaseService: DatabaseService
  private cacheService: CacheService
  private paymentRouter: PaymentRouter
  private paymentQueue: PaymentRequest[] = []
  private processing = false

  constructor() {
    this.databaseService = new DatabaseService()
    this.cacheService = new CacheService()
    this.paymentRouter = new PaymentRouter()

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
    const promises = payments.map(payment => this.processPayment(payment))
    await Promise.allSettled(promises)
  }

  private async processPayment(payment: PaymentRequest): Promise<void> {
    try {
      const result = await this.paymentRouter.processPaymentWithRetry(payment)
      const requestedAt = new Date().toISOString()

      if (!result.response.ok) return
      
      const processorType = result.processor.type
      
      const processedPayment = {
        correlationId: payment.correlationId,
        amount: payment.amount,
        processor: processorType,
        requestedAt,
        status: 'processed' as const
      }

      // Atomic transaction: DB + Cache together
      await this.databaseService.executeAtomicPaymentPersistence(
        processedPayment,
        async () => {
          await this.cacheService.updateCache(processorType, payment.amount)
        }
      )
    } catch (error) {
      console.error('Error processing payment:', error)
    }
  }


  async addPayment(payment: PaymentRequest): Promise<void> {
    this.paymentQueue.push(payment)
  }

  async getPaymentsSummary(from?: string, to?: string): Promise<PaymentSummary> {
    try {
      if (!from && !to) {
        const cachedSummary = await this.cacheService.getCachedSummary()
        if (cachedSummary) return cachedSummary
      }

      return await this.databaseService.getDatabaseSummary(from, to)
    } catch (error) {
      console.error('Error getting payments summary:', error)
      return {
        default: { totalRequests: 0, totalAmount: 0 },
        fallback: { totalRequests: 0, totalAmount: 0 }
      }
    }
  }

  async purgeAll(): Promise<{ database: boolean; cache: boolean; queue: boolean }> {
    const results = {
      database: false,
      cache: false,
      queue: false
    }

    try {
      // Clear processing queue
      this.paymentQueue = []
      results.queue = true
      console.log('Payment queue cleared')

      // Purge database
      await this.databaseService.purgeDatabase()
      results.database = true

      // Purge cache
      await this.cacheService.purgeCache()
      results.cache = true

      console.log('Complete purge successful')
      return results
    } catch (error) {
      console.error('Error during purge operation:', error)
      return results
    }
  }

}