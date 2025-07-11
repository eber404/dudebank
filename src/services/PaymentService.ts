import { config } from '../config'
import { DatabaseService } from './DatabaseService'
import { CacheService } from './CacheService'
import { ProcessorService } from './ProcessorService'
import type { PaymentRequest, PaymentSummary, ProcessedPayment } from '../types'

export class PaymentService {
  private databaseService: DatabaseService
  private cacheService: CacheService
  private processorService: ProcessorService
  private paymentQueue: PaymentRequest[] = []
  private processing = false

  constructor() {
    this.databaseService = new DatabaseService()
    this.cacheService = new CacheService()
    this.processorService = new ProcessorService()
    
    this.startPaymentProcessor()
  }

  private startPaymentProcessor(): void {
    setInterval(async () => {
      if (this.processing || this.paymentQueue.length === 0) return

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
      const processor = this.processorService.selectProcessor()
      const requestedAt = new Date().toISOString()
      
      const success = await this.sendPaymentToProcessor(payment, processor.url, processor.type, requestedAt)
      if (success) return

      if (processor.type !== 'default') return

      const fallbackProcessor = this.processorService.getProcessor('fallback')!
      await this.sendPaymentToProcessor(payment, fallbackProcessor.url, fallbackProcessor.type, requestedAt)
    } catch (error) {
      console.error('Error processing payment:', error)
    }
  }

  private async sendPaymentToProcessor(
    payment: PaymentRequest, 
    url: string,
    processorType: string,
    requestedAt: string
  ): Promise<boolean> {
    try {
      const response = await this.processorService.fetchPaymentRequest(payment, url, requestedAt)
      
      if (!response.ok) return false

      await this.databaseService.persistPayment({
        correlationId: payment.correlationId,
        amount: payment.amount,
        processor: processorType,
        requestedAt,
        status: 'processed'
      })

      await this.cacheService.updateCache(processorType, payment.amount)
      return true
    } catch (error) {
      return false
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
}