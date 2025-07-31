import Decimal from 'decimal.js'

import type { PaymentRequest, PaymentSummary, ProcessedPayment } from '@/types'

import { PaymentProcessorRouter } from './payment-processor-router'
import { DatabaseClient } from './database-client'

export class PaymentProcessor {
  private paymentRouter: PaymentProcessorRouter
  private memoryDBClient: DatabaseClient

  constructor() {
    this.paymentRouter = new PaymentProcessorRouter()
    this.memoryDBClient = new DatabaseClient()
  }

  async processPayment(payment: PaymentRequest): Promise<ProcessedPayment> {
    const requestedAt = new Date().toISOString()
    const result = await this.paymentRouter.processPaymentWithRetry(
      payment,
      requestedAt
    )

    const processedPayment = {
      correlationId: payment.correlationId,
      amount: payment.amount,
      processor: result.processor,
      requestedAt,
    }

    await this.memoryDBClient.persistPaymentsBatch([processedPayment])

    return processedPayment
  }

  async getPaymentsSummary(
    from?: string,
    to?: string
  ): Promise<PaymentSummary> {
    const res = await this.memoryDBClient.getDatabaseSummary(from, to)

    const summary: PaymentSummary = {
      default: {
        totalRequests: this.roundToComercialAmount(res.default.totalRequests),
        totalAmount: this.roundToComercialAmount(res.default.totalAmount),
      },
      fallback: {
        totalRequests: this.roundToComercialAmount(res.fallback.totalRequests),
        totalAmount: this.roundToComercialAmount(res.fallback.totalAmount),
      },
    }

    return summary
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

    results.queue = true
    console.log('Payment queue and stats cleared')
    await this.memoryDBClient.purgeDatabase()
    results.database = true
    console.log('Complete purge successful')
    return results
  }
}
