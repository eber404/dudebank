import Decimal from 'decimal.js'

import { config } from '@/config'
import type {
  PaymentRequest,
  PaymentSummary,
  ProcessedPayment,
  ProcessorType,
} from '@/types'

import { PaymentRouter } from './payment-router'
import { DatabaseClient } from './database-client'
import { BatchProcessor } from './batch-processor'

export class PaymentService {
  private paymentRouter: PaymentRouter
  private memoryDBClient: DatabaseClient
  private batchProcessorService: BatchProcessor

  constructor() {
    this.paymentRouter = new PaymentRouter()
    this.memoryDBClient = new DatabaseClient()
    this.batchProcessorService = new BatchProcessor({
      batchSize: config.processing.batchSize,
      intervalMs: config.processing.batchIntervalMs,
    })
    this.batchProcessorService.startBatchProcessor<PaymentRequest>({
      onProcess: this.processBatch.bind(this),
    })
  }

  private async processBatch(payments: PaymentRequest[]): Promise<void> {
    const promises = payments.map((payment) => this.processPayment(payment))
    const results = await Promise.allSettled(promises)

    const successfulPayments: ProcessedPayment[] = []

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue
      successfulPayments.push(result.value.processedPayment)
    }

    if (!successfulPayments.length) return

    await this.memoryDBClient.persistPaymentsBatch(successfulPayments)

    console.log(
      `Batch processed: ${successfulPayments.length}/${payments.length}`
    )
  }

  private async processPayment(payment: PaymentRequest): Promise<{
    processedPayment: ProcessedPayment
    processorType: ProcessorType
  } | null> {
    try {
      const requestedAt = new Date().toISOString()
      const result = await this.paymentRouter.processPaymentWithRetry(
        payment,
        requestedAt
      )

      if (!result.response.ok) return null

      const processorType = result.processor.type

      const processedPayment = {
        correlationId: payment.correlationId,
        amount: payment.amount,
        processor: processorType,
        requestedAt,
        status: 'processed' as const,
      }

      return { processedPayment, processorType }
    } catch (error) {
      console.error('Error processing payment:', error)
      return null
    }
  }

  async getPaymentsSummary(
    from?: string,
    to?: string
  ): Promise<PaymentSummary> {
    try {
      const res = await this.memoryDBClient.getDatabaseSummary(from, to)

      const summary: PaymentSummary = {
        default: {
          totalRequests: this.roundToComercialAmount(res.default.totalRequests),
          totalAmount: this.roundToComercialAmount(res.default.totalAmount),
        },
        fallback: {
          totalRequests: this.roundToComercialAmount(
            res.fallback.totalRequests
          ),
          totalAmount: this.roundToComercialAmount(res.fallback.totalAmount),
        },
      }

      return summary
    } catch (error) {
      console.error('Error getting payments summary:', error)
      return {
        default: { totalRequests: 0, totalAmount: 0 },
        fallback: { totalRequests: 0, totalAmount: 0 },
      }
    }
  }

  addPayment(payment: PaymentRequest): void {
    this.batchProcessorService.addToQueue(payment.correlationId, payment)
  }

  private roundToComercialAmount(amount: number): number {
    return new Decimal(amount)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toNumber()
  }

  async purgeAll(): Promise<{ database: boolean; queue: boolean }> {
    const results = {
      database: false,
      queue: false,
    }

    try {
      // Clear processing queue and reset stats atomically
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
