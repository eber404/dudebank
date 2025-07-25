import { Database } from 'bun:sqlite'
import type { ProcessedPayment, PaymentSummary } from '@/types'
import { config } from '@/config'

export class MemoryDBService {
  private db: Database
  private persistQueue: Map<string, ProcessedPayment> = new Map()
  private isProcessingBatch = false

  constructor() {
    const dbPath = Bun.env.DATABASE_PATH || '/app/data/payments.db'
    this.db = new Database(dbPath)
    this.initDB()
    this.startPersistProcessor()
  }

  private initDB(): void {
    // drop
    this.db.exec('DROP TABLE IF EXISTS payments')
    this.db.exec('DROP INDEX IF EXISTS idx_requested_at_processor')
    this.db.exec('DROP INDEX IF EXISTS idx_payments_summary')

    // Create payments table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        correlation_id TEXT UNIQUE NOT NULL,
        amount REAL NOT NULL,
        processor TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        processed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_requested_at_processor 
      ON payments(requested_at, processor)
    `)

    console.log('SQLite database initialized')
  }

  private startPersistProcessor(): void {
    setInterval(async () => {
      if (this.isProcessingBatch || !this.persistQueue.size) {
        this.persistQueue.size &&
          console.log(`Persist queue size: ${this.persistQueue.size}`)
        return
      }
      this.isProcessingBatch = true
      try {
        const batch = this.extractBatch()
        if (!batch.length) return
        await this.persistBatch(batch)
      } finally {
        this.isProcessingBatch = false
      }
    }, config.processing.batchIntervalMs)
  }

  private extractBatch(): ProcessedPayment[] {
    const batch: ProcessedPayment[] = []
    const entries = Array.from(this.persistQueue.entries()).slice(
      0,
      config.processing.batchSize
    )

    for (const entry of entries) {
      if (!entry) continue
      const [correlationId, payment] = entry
      batch.push(payment)
      this.persistQueue.delete(correlationId)
    }

    return batch
  }

  private async persistBatch(payments: ProcessedPayment[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO payments 
      (correlation_id, amount, processor, requested_at) 
      VALUES (?, ?, ?, ?)
    `)

    const transaction = this.db.transaction((payments: ProcessedPayment[]) => {
      for (const payment of payments) {
        stmt.run(
          payment.correlationId,
          payment.amount,
          payment.processor,
          payment.requestedAt
        )
      }
    })

    transaction(payments)
    console.log(`Persisted batch: ${payments.length} payments`)
  }

  addPaymentsToPersistQueue(payments: ProcessedPayment[]): void {
    for (const payment of payments) {
      this.persistQueue.set(payment.correlationId, payment)
    }
  }

  async persistPaymentsBatch(payments: ProcessedPayment[]): Promise<void> {
    if (!payments.length) return
    this.addPaymentsToPersistQueue(payments)
  }

  async getDatabaseSummary(
    from?: string,
    to?: string
  ): Promise<PaymentSummary> {
    let query = `
      SELECT 
        processor,
        COUNT(*) as total_requests,
        SUM(amount) as total_amount
      FROM payments
    `

    const params: any[] = []

    if (from && to) {
      query += ` WHERE requested_at BETWEEN ? AND ?`
      params.push(from, to)
    } else if (from) {
      query += ` WHERE requested_at >= ?`
      params.push(from)
    } else if (to) {
      query += ` WHERE requested_at <= ?`
      params.push(to)
    }

    query += ` GROUP BY processor`

    const stmt = this.db.prepare(query)
    const results = stmt.all(...params) as Array<{
      processor: string
      total_requests: number
      total_amount: number
    }>

    const summary: PaymentSummary = {
      default: { totalRequests: 0, totalAmount: 0 },
      fallback: { totalRequests: 0, totalAmount: 0 },
    }

    for (const row of results) {
      if (row.processor === 'default' || row.processor === 'fallback') {
        summary[row.processor as keyof PaymentSummary] = {
          totalRequests: row.total_requests,
          totalAmount: row.total_amount,
        }
      }
    }

    return summary
  }

  async purgeDatabase(): Promise<void> {
    this.db.exec('DELETE FROM payments')
    this.db.exec('DELETE FROM sqlite_sequence WHERE name = "payments"')
    console.log('SQLite database purged successfully')
  }
}
