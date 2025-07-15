import { Database } from 'bun:sqlite'
import type { ProcessedPayment, PaymentSummary } from '@/types'

export class MemoryDBService {
  private db: Database
  private isLocked: boolean = false

  constructor() {
    const dbPath = Bun.env.DATABASE_PATH || '/app/data/payments.db'
    this.db = new Database(dbPath)
    this.initDB()
  }

  private initDB(): void {
    // Create payments table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        correlation_id TEXT UNIQUE NOT NULL,
        amount REAL NOT NULL,
        processor TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processed',
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

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_payments_summary 
      ON payments(status, processor, amount, requested_at) 
      WHERE status = 'processed'
    `)

    console.log('SQLite database initialized')
  }


  async persistPaymentsBatch(payments: ProcessedPayment[]): Promise<void> {
    try {
      if (this.isLocked) {
        return this.persistPaymentsBatch(payments)
      }

      this.isLocked = true

      if (payments.length === 0) return

      const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO payments 
      (correlation_id, amount, processor, requested_at, status) 
      VALUES (?, ?, ?, ?, ?)
    `)

      const transaction = this.db.transaction((payments: ProcessedPayment[]) => {
        for (const payment of payments) {
          stmt.run(
            payment.correlationId,
            payment.amount,
            payment.processor,
            payment.requestedAt,
            payment.status
          )
        }
      })

      transaction(payments)

      this.isLocked = false
    } catch (error) {
      throw error
    } finally {
      this.isLocked = false
    }
  }

  async getDatabaseSummary(from?: string, to?: string): Promise<PaymentSummary> {
    let query = `
      SELECT 
        processor,
        COUNT(*) as total_requests,
        SUM(amount) as total_amount
      FROM payments
      WHERE status = 'processed'
    `

    const params: any[] = []

    if (from && to) {
      query += ` AND requested_at BETWEEN ? AND ?`
      params.push(from, to)
    } else if (from) {
      query += ` AND requested_at >= ?`
      params.push(from)
    } else if (to) {
      query += ` AND requested_at <= ?`
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
      fallback: { totalRequests: 0, totalAmount: 0 }
    }

    for (const row of results) {
      if (row.processor === 'default' || row.processor === 'fallback') {
        summary[row.processor as keyof PaymentSummary] = {
          totalRequests: row.total_requests,
          totalAmount: row.total_amount
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