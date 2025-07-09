import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { Pool } from 'pg'
import { Redis } from 'ioredis'

interface PaymentRequest {
  correlationId: string
  amount: number
}

interface PaymentProcessor {
  url: string
  type: 'default' | 'fallback'
  isHealthy: boolean
  minResponseTime: number
  lastHealthCheck: number
}

interface PaymentSummary {
  default: {
    totalRequests: number
    totalAmount: number
  }
  fallback: {
    totalRequests: number
    totalAmount: number
  }
}

class PaymentService {
  private db: Pool
  private redis: Redis
  private processors: Map<string, PaymentProcessor>
  private paymentQueue: PaymentRequest[] = []
  private processing = false

  constructor() {
    this.db = new Pool({
      host: process.env.DB_HOST || 'postgres',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'rinha_dev',
      user: process.env.DB_USER || 'dev',
      password: process.env.DB_PASSWORD || 'dev123',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })

    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    })

    this.processors = new Map([
      ['default', {
        url: process.env.PAYMENT_PROCESSOR_URL_DEFAULT || 'http://payment-processor-default:8080',
        type: 'default',
        isHealthy: true,
        minResponseTime: 0,
        lastHealthCheck: 0
      }],
      ['fallback', {
        url: process.env.PAYMENT_PROCESSOR_URL_FALLBACK || 'http://payment-processor-fallback:8080',
        type: 'fallback',
        isHealthy: true,
        minResponseTime: 0,
        lastHealthCheck: 0
      }]
    ])

    this.initDB()
    this.startPaymentProcessor()
    this.startHealthChecker()
  }

  private async initDB() {
    try {
      // Database already initialized, just verify connection
      await this.db.query('SELECT 1')
      console.log('Database connection established')
    } catch (error) {
      console.error('Error connecting to database:', error)
    }
  }

  private async startPaymentProcessor() {
    setInterval(async () => {
      if (!this.processing && this.paymentQueue.length > 0) {
        this.processing = true
        const batch = this.paymentQueue.splice(0, 50) // Process in batches
        await this.processBatch(batch)
        this.processing = false
      }
    }, 10)
  }

  private async processBatch(payments: PaymentRequest[]) {
    const promises = payments.map(payment => this.processPayment(payment))
    await Promise.allSettled(promises)
  }

  private async processPayment(payment: PaymentRequest): Promise<void> {
    try {
      const processor = this.selectProcessor()
      const requestedAt = new Date().toISOString()
      
      const response = await fetch(`${processor.url}/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          correlationId: payment.correlationId,
          amount: payment.amount,
          requestedAt
        }),
        signal: AbortSignal.timeout(5000)
      })

      if (response.ok) {
        await this.db.query(
          'INSERT INTO payments (correlation_id, amount, processor, requested_at, status) VALUES ($1, $2, $3, $4, $5)',
          [payment.correlationId, payment.amount, processor.type, requestedAt, 'processed']
        )
        
        // Cache for quick summary retrieval
        await this.redis.incr(`payments:${processor.type}:count`)
        await this.redis.incrbyfloat(`payments:${processor.type}:amount`, payment.amount)
      } else {
        // Retry with fallback if default fails
        if (processor.type === 'default') {
          const fallbackProcessor = this.processors.get('fallback')!
          const fallbackResponse = await fetch(`${fallbackProcessor.url}/payments`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              correlationId: payment.correlationId,
              amount: payment.amount,
              requestedAt
            }),
            signal: AbortSignal.timeout(5000)
          })

          if (fallbackResponse.ok) {
            await this.db.query(
              'INSERT INTO payments (correlation_id, amount, processor, requested_at, status) VALUES ($1, $2, $3, $4, $5)',
              [payment.correlationId, payment.amount, 'fallback', requestedAt, 'processed']
            )
            
            await this.redis.incr('payments:fallback:count')
            await this.redis.incrbyfloat('payments:fallback:amount', payment.amount)
          }
        }
      }
    } catch (error) {
      console.error('Error processing payment:', error)
    }
  }

  private selectProcessor(): PaymentProcessor {
    const defaultProcessor = this.processors.get('default')!
    const fallbackProcessor = this.processors.get('fallback')!
    
    // Prefer default if healthy
    if (defaultProcessor.isHealthy) {
      return defaultProcessor
    }
    
    return fallbackProcessor
  }

  private async startHealthChecker() {
    setInterval(async () => {
      for (const [, processor] of this.processors) {
        const now = Date.now()
        // Check health every 6 seconds (respecting 5-second limit)
        if (now - processor.lastHealthCheck > 6000) {
          try {
            const response = await fetch(`${processor.url}/payments/service-health`, {
              signal: AbortSignal.timeout(2000)
            })
            
            if (response.ok) {
              const health = await response.json() as { failing: boolean; minResponseTime: number }
              processor.isHealthy = !health.failing
              processor.minResponseTime = health.minResponseTime
              processor.lastHealthCheck = now
            } else {
              processor.isHealthy = false
            }
          } catch (error) {
            processor.isHealthy = false
          }
        }
      }
    }, 1000)
  }

  async addPayment(payment: PaymentRequest): Promise<void> {
    this.paymentQueue.push(payment)
  }

  async getPaymentsSummary(from?: string, to?: string): Promise<PaymentSummary> {
    try {
      // Try Redis cache first
      const [defaultCount, defaultAmount, fallbackCount, fallbackAmount] = await Promise.all([
        this.redis.get('payments:default:count'),
        this.redis.get('payments:default:amount'),
        this.redis.get('payments:fallback:count'),
        this.redis.get('payments:fallback:amount')
      ])

      if (defaultCount !== null && !from && !to) {
        return {
          default: {
            totalRequests: parseInt(defaultCount || '0'),
            totalAmount: parseFloat(defaultAmount || '0')
          },
          fallback: {
            totalRequests: parseInt(fallbackCount || '0'),
            totalAmount: parseFloat(fallbackAmount || '0')
          }
        }
      }

      // Fallback to database query
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

      const result = await this.db.query(query, params)
      
      const summary: PaymentSummary = {
        default: { totalRequests: 0, totalAmount: 0 },
        fallback: { totalRequests: 0, totalAmount: 0 }
      }

      for (const row of result.rows) {
        summary[row.processor as keyof PaymentSummary] = {
          totalRequests: parseInt(row.total_requests),
          totalAmount: parseFloat(row.total_amount)
        }
      }

      return summary
    } catch (error) {
      console.error('Error getting payments summary:', error)
      return {
        default: { totalRequests: 0, totalAmount: 0 },
        fallback: { totalRequests: 0, totalAmount: 0 }
      }
    }
  }
}

const paymentService = new PaymentService()

new Elysia()
  .use(cors())
  .post('/payments', async ({ body }) => {
    const payment = body as PaymentRequest
    
    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(payment.correlationId)) {
      return new Response('Invalid correlationId format', { status: 400 })
    }

    await paymentService.addPayment(payment)
    return new Response('Payment accepted', { status: 202 })
  })
  .get('/payments-summary', async ({ query }) => {
    const { from, to } = query as { from?: string; to?: string }
    const summary = await paymentService.getPaymentsSummary(from, to)
    return summary
  })
  .listen(process.env.SERVER_PORT || 8080)

console.log(`>� Server is running at http://localhost:${process.env.SERVER_PORT || 8080}`)