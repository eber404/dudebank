import { Redis } from 'ioredis'

import { config } from '@/config'
import type { PaymentSummary } from '@/types'

export class CacheService {
  private redis: Redis

  constructor() {
    this.redis = new Redis(config.redis)
  }

  async updateCache(processorType: string, amount: number): Promise<void> {
    await Promise.all([
      this.redis.incr(`payments:${processorType}:count`),
      this.redis.incrbyfloat(`payments:${processorType}:amount`, amount)
    ])
  }

  async getCachedSummary(): Promise<PaymentSummary | null> {
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
}