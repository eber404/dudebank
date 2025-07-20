import Redis from 'ioredis'
import type { ProcessedPayment, PaymentSummary, ProcessorType } from '@/types'

export class RedisService {
  private redis: Redis

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: 3,
    })
  }

  async persistPaymentsBatch(payments: ProcessedPayment[]): Promise<void> {
    if (payments.length === 0) return

    const pipeline = this.redis.pipeline()

    for (const payment of payments) {
      const key = `payment:${payment.correlationId}`
      pipeline.hset(key, {
        correlationId: payment.correlationId,
        amount: payment.amount.toString(),
        processor: payment.processor,
        requestedAt: payment.requestedAt,
        status: payment.status,
      })

      // Add to processor-specific sorted set for quick summary queries
      const scoreKey = `processor:${payment.processor}:payments`
      pipeline.zadd(scoreKey, Date.parse(payment.requestedAt), payment.correlationId)

      // Update running totals
      pipeline.hincrbyfloat(`summary:${payment.processor}`, 'totalAmount', payment.amount)
      pipeline.hincrby(`summary:${payment.processor}`, 'totalRequests', 1)
    }

    await pipeline.exec()
  }

  async getDatabaseSummary(from?: string, to?: string): Promise<PaymentSummary> {
    const defaultSummary = await this.getProcessorSummary('default', from, to)
    const fallbackSummary = await this.getProcessorSummary('fallback', from, to)

    return {
      default: defaultSummary,
      fallback: fallbackSummary,
    }
  }

  private async getProcessorSummary(
    processor: 'default' | 'fallback',
    from?: string,
    to?: string
  ): Promise<{ totalRequests: number; totalAmount: number }> {
    const scoreKey = `processor:${processor}:payments`

    let paymentIds: string[]
    if (from || to) {
      const fromScore = from ? Date.parse(from) : '-inf'
      const toScore = to ? Date.parse(to) : '+inf'
      paymentIds = await this.redis.zrangebyscore(scoreKey, fromScore, toScore)
    } else {
      // Use cached summary if no date filters
      const cachedSummary = await this.redis.hmget(`summary:${processor}`, 'totalAmount', 'totalRequests')
      if (cachedSummary[0] && cachedSummary[1]) {
        return {
          totalAmount: parseFloat(cachedSummary[0]),
          totalRequests: parseInt(cachedSummary[1], 10),
        }
      }
      paymentIds = await this.redis.zrange(scoreKey, 0, -1)
    }

    if (paymentIds.length === 0) {
      return { totalRequests: 0, totalAmount: 0 }
    }

    // Get payment details
    const pipeline = this.redis.pipeline()
    for (const id of paymentIds) {
      pipeline.hget(`payment:${id}`, 'amount')
    }

    const results = await pipeline.exec()
    let totalAmount = 0
    let totalRequests = 0

    for (const result of results || []) {
      if (result && result[1]) {
        totalAmount += parseFloat(result[1] as string)
        totalRequests++
      }
    }

    return { totalRequests, totalAmount }
  }

  async purgeDatabase(): Promise<void> {
    await this.redis.flushdb()
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.redis.ping()
      return result === 'PONG'
    } catch {
      return false
    }
  }

  async setOptimalProcessor(processorType: ProcessorType): Promise<void> {
    await this.redis.set('optimal_processor', processorType)
  }

  async getOptimalProcessor(): Promise<ProcessorType | null> {
    const result = await this.redis.get('optimal_processor') as ProcessorType | null
    return result
  }

  async removeOptimalProcessor(): Promise<void> {
    await this.redis.del('optimal_processor')
  }

  async disconnect(): Promise<void> {
    await this.redis.quit()
  }
}