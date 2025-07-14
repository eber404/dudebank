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

  async purgeCache(): Promise<void> {
    try {
      // Clear all payment-related cache keys
      const keys = await this.redis.keys('payments:*')
      if (keys.length > 0) {
        await this.redis.del(...keys)
      }
      console.log(`Cache purged successfully - ${keys.length} keys deleted`)
    } catch (error) {
      console.error('Error purging cache:', error)
      throw error
    }
  }

  async getCacheStats(): Promise<{ keyCount: number; memoryUsage: string }> {
    try {
      const keys = await this.redis.keys('payments:*')
      const info = await this.redis.info('memory')
      const memoryMatch = info.match(/used_memory_human:(.+)/)
      return {
        keyCount: keys.length,
        memoryUsage: memoryMatch && memoryMatch[1] ? memoryMatch[1].trim() : 'unknown'
      }
    } catch (error) {
      console.error('Error getting cache stats:', error)
      return { keyCount: 0, memoryUsage: 'unknown' }
    }
  }
}