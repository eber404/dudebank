import { Database } from 'bun:sqlite'
import { Mutex } from 'async-mutex'

import type { ProcessedPayment, PaymentSummary } from '@/types'

export class DatabaseService {
  private db: Database
  private mutationMutex: Mutex
  private queryMutex: Mutex
  private mutationPriority = 0
  private insertStmt: any

  constructor() {
    const dbPath = Bun.env.DATABASE_PATH ?? '/app/data/payments.db'
    // Ensure directory exists with correct permissions
    const fs = require('fs')
    const path = require('path')
    const dbDir = path.dirname(dbPath)
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true, mode: 0o755 })
    }

    this.db = new Database(dbPath)
    this.mutationMutex = new Mutex()
    this.queryMutex = new Mutex()
    this.initDB()
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

    // Prepare reusable statement
    this.insertStmt = this.db.prepare(`
      INSERT OR IGNORE INTO payments 
      (correlation_id, amount, processor, requested_at) 
      VALUES (?, ?, ?, ?)
    `)

    console.log('SQLite database initialized')
  }

  async persistPayments(payments: ProcessedPayment[]): Promise<void> {
    if (!payments.length) return

    await this.mutationMutex.runExclusive(async () => {
      const transaction = this.db.transaction(() => {
        for (const payment of payments) {
          this.insertStmt.run(
            payment.correlationId,
            payment.amount,
            payment.processor,
            payment.requestedAt
          )
        }
      })

      transaction()
      console.log(`Persisted batch of ${payments.length} payments`)
      this.mutationPriority++
    }, this.mutationPriority)
  }

  async getDatabaseSummary(
    from?: string,
    to?: string
  ): Promise<PaymentSummary> {
    return this.queryMutex.runExclusive(async () => {
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
    })
  }

  async purgeDatabase(): Promise<void> {
    this.db.exec('DELETE FROM payments')
    this.db.exec('DELETE FROM sqlite_sequence WHERE name = "payments"')
    console.log('SQLite database purged successfully')
  }
}
