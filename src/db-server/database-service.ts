import type { ProcessedPayment, PaymentSummary } from '@/types'

import { MemoryStore } from './memory-store'
import { Mutex } from 'async-mutex'

export class DatabaseService {
  private memoryStore: MemoryStore
  private mutex: Mutex

  constructor() {
    this.memoryStore = new MemoryStore()
    this.mutex = new Mutex()
  }

  persistPayments(payments: ProcessedPayment[]) {
    this.mutex.runExclusive(() => {
      if (!payments.length) return

      for (const payment of payments) {
        this.memoryStore.add(Date.parse(payment.requestedAt), payment.amount)
      }
    })
  }

  async getDatabaseSummary(from?: string, to?: string) {
    return this.mutex.runExclusive(() => {
      const allData = this.memoryStore.getAll()

      const fromTimestamp = from ? Date.parse(from) : 0
      const toTimestamp = to ? Date.parse(to) : Date.now()

      const filteredData = allData.filter(
        (item) =>
          item.timestamp >= fromTimestamp && item.timestamp <= toTimestamp
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
    })
  }

  purgeDatabase() {
    this.memoryStore.clear()
    console.log('MemoryStore database purged successfully')
  }
}
