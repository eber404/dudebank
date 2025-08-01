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

    await this.memoryDBClient.persistPaymentsBatch(processedPayments)

    return processedPayments
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

  async purgeAll(): Promise<void> {
    await this.memoryDBClient.purgeDatabase()
    console.log('Complete purge successful')
  }
}
