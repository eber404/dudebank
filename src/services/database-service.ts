import { Pool } from 'pg'
import { config } from '@/config'
import type { ProcessedPayment, PaymentSummary, DatabaseRow } from '@/types'

export class DatabaseService {
  private db: Pool

  constructor() {
    this.db = new Pool(config.database)
    this.initDB()
  }

  private async initDB(): Promise<void> {
    try {
      await this.db.query('SELECT 1')
      console.log('Database connection established')
    } catch (error) {
      console.error('Error connecting to database:', error)
    }
  }

  async persistPayment(payment: ProcessedPayment): Promise<void> {
    await this.db.query(
      'INSERT INTO payments (correlation_id, amount, processor, requested_at, status) VALUES ($1, $2, $3, $4, $5)',
      [payment.correlationId, payment.amount, payment.processor, payment.requestedAt, payment.status]
    )
  }

  async getDatabaseSummary(from?: string, to?: string): Promise<PaymentSummary> {
    const { query, params } = this.buildSummaryQuery(from, to)
    const result = await this.db.query(query, params)
    
    const summary = this.getEmptySummary()
    
    for (const row of result.rows) {
      summary[row.processor as keyof PaymentSummary] = {
        totalRequests: parseInt(row.total_requests),
        totalAmount: parseFloat(row.total_amount)
      }
    }

    return summary
  }

  private buildSummaryQuery(from?: string, to?: string): { query: string; params: any[] } {
    let query = `
      SELECT 
        processor,
        COUNT(*) as total_requests,
        COALESCE(SUM(amount), 0) as total_amount
      FROM payments
      WHERE status = 'processed'
    `
    const params: any[] = []

    if (from || to) {
      const conditions = []
      if (from) {
        conditions.push(`requested_at >= $${params.length + 1}`)
        params.push(from)
      }
      if (to) {
        conditions.push(`requested_at <= $${params.length + 1}`)
        params.push(to)
      }
      query += ' AND ' + conditions.join(' AND ')
    }

    query += ' GROUP BY processor'

    return { query, params }
  }

  private getEmptySummary(): PaymentSummary {
    return {
      default: { totalRequests: 0, totalAmount: 0 },
      fallback: { totalRequests: 0, totalAmount: 0 }
    }
  }
}