import { Pool } from 'pg'

import { config } from '@/config'
import type { ProcessedPayment, PaymentSummary } from '@/types'

export class DatabaseService {
  private db: Pool

  constructor() {
    this.db = new Pool(config.database)
    this.initDB()
  }

  private async initDB(): Promise<void> {
    const maxRetries = 10
    const retryDelay = 2000 // 2 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.db.query('SELECT 1')
        console.log(`Database connection established on attempt ${attempt}`)
        return
      } catch (error) {
        console.log(`Database connection attempt ${attempt}/${maxRetries} failed`)

        if (attempt === maxRetries) {
          console.error('Failed to connect to database after all retries:', error)
          return
        }

        console.log(`Retrying in ${retryDelay}ms...`)
        await new Promise(resolve => setTimeout(resolve, retryDelay))
      }
    }
  }

  async persistPayment(payment: ProcessedPayment): Promise<void> {
    await this.db.query(
      'INSERT INTO payments (correlation_id, amount, processor, requested_at, status) VALUES ($1, $2, $3, $4, $5)',
      [payment.correlationId, payment.amount, payment.processor, payment.requestedAt, payment.status]
    )
  }

  async executeAtomicPaymentPersistence(
    payment: ProcessedPayment, 
    cacheUpdateFn: () => Promise<void>
  ): Promise<void> {
    const client = await this.db.connect()
    
    try {
      await client.query('BEGIN')
      
      // Insert payment in database
      await client.query(
        'INSERT INTO payments (correlation_id, amount, processor, requested_at, status) VALUES ($1, $2, $3, $4, $5)',
        [payment.correlationId, payment.amount, payment.processor, payment.requestedAt, payment.status]
      )
      
      // Execute cache update
      await cacheUpdateFn()
      
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
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
    const params: any[] = []

    if (from && to) {
      // Optimized query with BETWEEN for time range filtering
      const query = `
        SELECT 
          processor,
          COUNT(*) AS total_requests,
          SUM(amount) AS total_amount
        FROM payments
        WHERE status = 'processed'
          AND requested_at BETWEEN $1 AND $2
        GROUP BY processor
      `
      params.push(from, to)
      return { query, params }
    }

    if (from || to) {
      let query = `
        SELECT 
          processor,
          COUNT(*) AS total_requests,
          SUM(amount) AS total_amount
        FROM payments
        WHERE status = 'processed'
      `

      if (from) {
        query += ` AND requested_at >= $${params.length + 1}`
        params.push(from)
      }
      if (to) {
        query += ` AND requested_at <= $${params.length + 1}`
        params.push(to)
      }

      query += ' GROUP BY processor'
      return { query, params }
    }

    // No time filtering - use the most optimized query
    const query = `
      SELECT 
        processor,
        COUNT(*) AS total_requests,
        SUM(amount) AS total_amount
      FROM payments
      WHERE status = 'processed'
      GROUP BY processor
    `

    return { query, params }
  }

  async purgeDatabase(): Promise<void> {
    try {
      // Truncate all tables used by the API
      await this.db.query('TRUNCATE TABLE payments RESTART IDENTITY CASCADE')
      console.log('Database purged successfully')
    } catch (error) {
      console.error('Error purging database:', error)
      throw error
    }
  }


  private getEmptySummary(): PaymentSummary {
    return {
      default: { totalRequests: 0, totalAmount: 0 },
      fallback: { totalRequests: 0, totalAmount: 0 }
    }
  }
}