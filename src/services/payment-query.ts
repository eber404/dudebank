import type { PaymentSummary } from '@/types'

import { DatabaseClient } from './database-client'

export class PaymentQuery {
  private db: DatabaseClient

  constructor() {
    this.db = new DatabaseClient()
  }

  async getPaymentsSummary(
    from?: string,
    to?: string
  ): Promise<PaymentSummary> {
    await this.db.flushAllPendingBatches()

    const res = await this.db.getDatabaseSummary(from, to)

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
    return parseFloat(amount.toFixed(2))
  }
}
