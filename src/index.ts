import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { Pool } from 'pg'
import { Redis } from 'ioredis'
import { config } from './config'

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

interface ProcessedPayment {
  correlationId: string
  amount: number
  processor: string
  requestedAt: string
  status: string
}

class PaymentService {
  private db: Pool
  private redis: Redis
  private processors: Map<string, PaymentProcessor>
  private paymentQueue: PaymentRequest[] = []
  private processing = false

  constructor() {
    this.db = new Pool(config.database)
    this.redis = new Redis(config.redis)
    this.processors = this.initializeProcessors()

    this.initDB()
    this.startPaymentProcessor()
    this.startHealthChecker()
  }

  private initializeProcessors(): Map<string, PaymentProcessor> {
    return new Map([
      ['default', {
        url: config.paymentProcessors.default.url,
        type: config.paymentProcessors.default.type,
        isHealthy: true,
        minResponseTime: 0,
        lastHealthCheck: 0
      }],
      ['fallback', {
        url: config.paymentProcessors.fallback.url,
        type: config.paymentProcessors.fallback.type,
        isHealthy: true,
        minResponseTime: 0,
        lastHealthCheck: 0
      }]
    ])
  }

  private async initDB(): Promise<void> {
    try {
      await this.db.query('SELECT 1')
      console.log('Database connection established')
    } catch (error) {
      console.error('Error connecting to database:', error)
    }
  }

  private startPaymentProcessor(): void {
    setInterval(async () => {
      if (this.processing || this.paymentQueue.length === 0) return

      this.processing = true
      const batch = this.paymentQueue.splice(0, config.processing.batchSize)
      await this.processBatch(batch)
      this.processing = false
    }, config.processing.batchIntervalMs)
  }

  private async processBatch(payments: PaymentRequest[]): Promise<void> {
    const promises = payments.map(payment => this.processPayment(payment))
    await Promise.allSettled(promises)
  }

  private async processPayment(payment: PaymentRequest): Promise<void> {
    try {
      const processor = this.selectProcessor()
      const requestedAt = new Date().toISOString()
      
      const success = await this.sendPaymentToProcessor(payment, processor, requestedAt)
      if (success) return

      if (processor.type !== 'default') return

      const fallbackProcessor = this.processors.get('fallback')!
      await this.sendPaymentToProcessor(payment, fallbackProcessor, requestedAt)
    } catch (error) {
      console.error('Error processing payment:', error)
    }
  }

  private async sendPaymentToProcessor(
    payment: PaymentRequest, 
    processor: PaymentProcessor, 
    requestedAt: string
  ): Promise<boolean> {
    try {
      const response = await this.fetchPaymentRequest(payment, processor.url, requestedAt)
      
      if (!response.ok) return false

      await this.persistPayment({
        correlationId: payment.correlationId,
        amount: payment.amount,
        processor: processor.type,
        requestedAt,
        status: 'processed'
      })

      await this.updateCache(processor.type, payment.amount)
      return true
    } catch (error) {
      return false
    }
  }

  private async fetchPaymentRequest(
    payment: PaymentRequest, 
    url: string, 
    requestedAt: string
  ): Promise<Response> {
    return fetch(`${url}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        correlationId: payment.correlationId,
        amount: payment.amount,
        requestedAt
      }),
      signal: AbortSignal.timeout(config.processing.requestTimeoutMs)
    })
  }

  private async persistPayment(payment: ProcessedPayment): Promise<void> {
    await this.db.query(
      'INSERT INTO payments (correlation_id, amount, processor, requested_at, status) VALUES ($1, $2, $3, $4, $5)',
      [payment.correlationId, payment.amount, payment.processor, payment.requestedAt, payment.status]
    )
  }

  private async updateCache(processorType: string, amount: number): Promise<void> {
    await Promise.all([
      this.redis.incr(`payments:${processorType}:count`),
      this.redis.incrbyfloat(`payments:${processorType}:amount`, amount)
    ])
  }

  private selectProcessor(): PaymentProcessor {
    const defaultProcessor = this.processors.get('default')!
    
    if (defaultProcessor.isHealthy) {
      return defaultProcessor
    }
    
    return this.processors.get('fallback')!
  }

  private startHealthChecker(): void {
    setInterval(async () => {
      for (const [, processor] of this.processors) {
        await this.checkProcessorHealth(processor)
      }
    }, config.processing.healthCheckIntervalMs)
  }

  private async checkProcessorHealth(processor: PaymentProcessor): Promise<void> {
    const now = Date.now()
    
    if (now - processor.lastHealthCheck <= config.processing.healthCheckCooldownMs) return

    try {
      const response = await fetch(`${processor.url}/payments/service-health`, {
        signal: AbortSignal.timeout(config.processing.healthCheckTimeoutMs)
      })

      if (response.ok) {
        const health = await response.json() as { failing: boolean; minResponseTime: number }
        processor.isHealthy = !health.failing
        processor.minResponseTime = health.minResponseTime
      } else {
        processor.isHealthy = false
      }
      
      processor.lastHealthCheck = now
    } catch (error) {
      processor.isHealthy = false
      processor.lastHealthCheck = now
    }
  }

  async addPayment(payment: PaymentRequest): Promise<void> {
    this.paymentQueue.push(payment)
  }

  async getPaymentsSummary(from?: string, to?: string): Promise<PaymentSummary> {
    try {
      if (!from && !to) {
        const cachedSummary = await this.getCachedSummary()
        if (cachedSummary) return cachedSummary
      }

      return await this.getDatabaseSummary(from, to)
    } catch (error) {
      console.error('Error getting payments summary:', error)
      return this.getEmptySummary()
    }
  }

  private async getCachedSummary(): Promise<PaymentSummary | null> {
    const [defaultCount, defaultAmount, fallbackCount, fallbackAmount] = await Promise.all([
      this.redis.get('payments:default:count'),
      this.redis.get('payments:default:amount'),
      this.redis.get('payments:fallback:count'),
      this.redis.get('payments:fallback:amount')
    ])

    if (defaultCount === null) return null

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

  private async getDatabaseSummary(from?: string, to?: string): Promise<PaymentSummary> {
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

class PaymentValidator {
  private static readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  static validatePaymentRequest(payment: PaymentRequest): string | null {
    if (!this.UUID_REGEX.test(payment.correlationId)) {
      return 'Invalid correlationId format'
    }
    return null
  }
}

const paymentService = new PaymentService()

new Elysia()
  .use(cors())
  .post('/payments', async ({ body }) => {
    const payment = body as PaymentRequest
    
    const validationError = PaymentValidator.validatePaymentRequest(payment)
    if (validationError) {
      return new Response(validationError, { status: 400 })
    }

    await paymentService.addPayment(payment)
    return new Response('Payment accepted', { status: 202 })
  })
  .get('/payments-summary', async ({ query }) => {
    const { from, to } = query as { from?: string; to?: string }
    const summary = await paymentService.getPaymentsSummary(from, to)
    return summary
  })
  .listen(config.server.port)

console.log(`🦊 Server is running at http://localhost:${config.server.port}`)