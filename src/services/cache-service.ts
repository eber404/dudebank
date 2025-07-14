import { Redis } from 'ioredis'

import { config } from '@/config'
import type { PaymentSummary, ProcessorHealth } from '@/types'

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

  // PaymentRouter cache methods
  async setOptimalProcessor(processorType: string): Promise<void> {
    await this.redis.setex('processor:optimal', 10, processorType)
  }

  async getOptimalProcessor(): Promise<string | null> {
    return await this.redis.get('processor:optimal')
  }

  async setProcessorHealth(processorType: string, health: ProcessorHealth): Promise<void> {
    await this.redis.setex(`processor:${processorType}:health`, 10, JSON.stringify(health))
  }

  async getProcessorHealth(processorType: string): Promise<ProcessorHealth | null> {
    const data = await this.redis.get(`processor:${processorType}:health`)
    return data ? JSON.parse(data) : null
  }

  // Leader election for health checks
  async manageHealthCheckLock(tryAcquire: boolean = false): Promise<boolean> {
    const lockKey = 'health-check-leader'
    const lockValue = process.pid.toString()

    const args: (string | number)[] = [lockKey, lockValue, 'PX', 7000]
    if (tryAcquire) {
      args.push('NX')
    }
    const result = await (this.redis as any).set(...args)
    return result === 'OK'
  }
}