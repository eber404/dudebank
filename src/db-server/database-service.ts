import type { ProcessedPayment, PaymentSummary } from '@/types'

import { MemoryStore } from './memory-store'

export class DatabaseService {
  private memoryStore: MemoryStore

  constructor() {
    this.memoryStore = new MemoryStore()
  }

  persistPayments(payments: ProcessedPayment[]) {
    if (!payments.length) return

    for (const payment of payments) {
      const timestamp = Date.parse(payment.requestedAt)
      this.memoryStore.add(timestamp, payment.amount)
    }
  }

  getDatabaseSummary(from?: string, to?: string) {
    const allData = this.memoryStore.getAll()

    const fromTimestamp = from ? Date.parse(from) : 0
    const toTimestamp = to ? Date.parse(to) : Date.now()

    const filteredData = allData.filter(
      (item) => item.timestamp >= fromTimestamp && item.timestamp <= toTimestamp
    )

    const summary: PaymentSummary = {
      default: { totalRequests: 0, totalAmount: 0 },
      fallback: { totalRequests: 0, totalAmount: 0 },
    }

    for (const item of filteredData) {
      summary[item.processor].totalRequests++
      summary[item.processor].totalAmount += item.value
    }

    return summary
  }

  async purgeDatabase(): Promise<void> {
    this.memoryStore.clear()
    console.log('MemoryStore database purged successfully')
  }
}
