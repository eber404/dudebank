import type { ProcessedPayment, PaymentSummary } from '@/types'
import { MemoryStore } from '@/services/memory-store'

export class DatabaseService {
  private memoryStore: MemoryStore

  constructor() {
    this.memoryStore = new MemoryStore()
  }

  persistPayments(payments: ProcessedPayment[]) {
    if (!payments.length) return

    for (const payment of payments) {
      const timestamp = Date.parse(payment.requestedAt)
      this.memoryStore.add(
        timestamp,
        payment.amount,
        payment.processor as 'default' | 'fallback'
      )
    }
  }

  getDatabaseSummary(from?: string, to?: string) {
    const allData = this.memoryStore.getAll()
    console.log(`------------- getDatabaseSummary -------------`)
    console.log(`Total items in memory: ${allData.length}`)
    console.log({ lastItem: allData[allData.length - 1] })

    const fromTimestamp = from ? Date.parse(from) : 0
    const toTimestamp = to ? Date.parse(to) : Date.now()
    console.log(`Filter range: ${fromTimestamp} to ${toTimestamp}`)
    console.log(
      `Filter range as dates: ${new Date(
        fromTimestamp
      ).toISOString()} to ${new Date(toTimestamp).toISOString()}`
    )

    const filteredData = allData.filter(
      (item) => item.timestamp >= fromTimestamp && item.timestamp <= toTimestamp
    )
    console.log(`Filtered items: ${filteredData.length}`)

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
