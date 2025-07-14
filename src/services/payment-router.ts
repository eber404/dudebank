import { config } from '@/config'
import type { PaymentRequest, PaymentProcessor, HealthCheckResponse } from '@/types'

interface LatencyMetrics {
  latencies: number[]
  successCount: number
  totalCount: number
  lastLatency: number
  isCircuitOpen: boolean
  circuitOpenTime: number
  consecutiveFailures: number
}

interface RoutingMetrics {
  p95Latency: number
  successRate: number
  totalCost: number
  paymentsPerSecond: number
  avgLatency: number
}

export class PaymentRouter {
  private processors: Map<string, PaymentProcessor>
  private metrics: Map<string, LatencyMetrics>
  private readonly LATENCY_WINDOW_SIZE = 10
  private readonly DEFAULT_THRESHOLD = 100
  private readonly FALLBACK_THRESHOLD = 150
  private readonly HYSTERESIS_THRESHOLD = 80
  private readonly CIRCUIT_BREAKER_TIMEOUT = 2000
  private readonly CIRCUIT_RECOVERY_TIME = 30000
  private readonly LATENCY_MULTIPLIER_THRESHOLD = 3
  private readonly healthCheckInterval: NodeJS.Timeout
  private readonly startupTime = Date.now()

  constructor() {
    this.processors = new Map()
    this.metrics = new Map()
    this.initializeProcessors()
    this.healthCheckInterval = this.startHealthChecker()
  }

  private initializeProcessors(): void {
    const processorConfigs = [
      { name: 'default', config: config.paymentProcessors.default },
      { name: 'fallback', config: config.paymentProcessors.fallback }
    ]

    for (const { name, config: procConfig } of processorConfigs) {
      this.processors.set(name, {
        url: procConfig.url,
        type: procConfig.type,
        isHealthy: true,
        minResponseTime: 0,
        lastHealthCheck: 0
      })

      this.metrics.set(name, {
        latencies: [],
        successCount: 0,
        totalCount: 0,
        lastLatency: 0,
        isCircuitOpen: false,
        circuitOpenTime: 0,
        consecutiveFailures: 0
      })
    }
  }

  selectOptimalProcessor(): PaymentProcessor {
    const defaultProcessor = this.processors.get('default')!
    const defaultMetrics = this.metrics.get('default')!

    if (defaultMetrics.isCircuitOpen) {
      const timeSinceOpen = Date.now() - defaultMetrics.circuitOpenTime
      if (timeSinceOpen <= this.CIRCUIT_RECOVERY_TIME) {
        return this.processors.get('fallback')!
      }
      defaultMetrics.isCircuitOpen = false
    }

    if (!defaultProcessor.isHealthy) {
      return this.processors.get('fallback')!
    }

    const latencies = defaultMetrics.latencies
    if (latencies.length === 0) {
      return defaultProcessor
    }

    const sum = latencies.reduce((a, b) => a + b, 0)
    const defaultAvgLatency = sum / latencies.length

    if (defaultAvgLatency <= this.DEFAULT_THRESHOLD) {
      return defaultProcessor
    }

    if (defaultAvgLatency > this.FALLBACK_THRESHOLD) {
      return this.processors.get('fallback')!
    }

    const fallbackLatencies = this.metrics.get('fallback')!.latencies
    if (fallbackLatencies.length > 0) {
      const fallbackSum = fallbackLatencies.reduce((a, b) => a + b, 0)
      const fallbackAvgLatency = fallbackSum / fallbackLatencies.length
      if (defaultAvgLatency > this.LATENCY_MULTIPLIER_THRESHOLD * fallbackAvgLatency) {
        return this.processors.get('fallback')!
      }
    }

    if (defaultAvgLatency < this.HYSTERESIS_THRESHOLD && defaultMetrics.consecutiveFailures === 0) {
      return defaultProcessor
    }

    return this.processors.get('fallback')!
  }

  async processPaymentWithRetry(payment: PaymentRequest): Promise<Response> {
    let lastError: Error | null = null
    let attempt = 0
    const maxRetries = 3

    while (attempt < maxRetries) {
      try {
        const processor = this.selectOptimalProcessor()
        const startTime = Date.now()

        const response = await this.executePaymentRequest(payment, processor)
        const latency = Date.now() - startTime

        this.recordMetrics(processor.type, latency, response.ok)

        if (response.ok) {
          return response
        } else {
          throw new Error(`Payment failed with status: ${response.status}`)
        }
      } catch (error) {
        lastError = error as Error
        attempt++

        if (attempt < maxRetries) {
          const backoffDelay = this.calculateBackoffDelay(attempt)
          await this.sleep(backoffDelay)
        }
      }
    }

    throw lastError || new Error('Payment processing failed after all retries')
  }

  private async executePaymentRequest(payment: PaymentRequest, processor: PaymentProcessor): Promise<Response> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.CIRCUIT_BREAKER_TIMEOUT)

    try {
      const requestedAt = new Date().toISOString()
      const response = await fetch(`${processor.url}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          correlationId: payment.correlationId,
          amount: payment.amount,
          requestedAt
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)
      return response
    } catch (error) {
      clearTimeout(timeoutId)
      throw error
    }
  }

  private recordMetrics(processorType: string, latency: number, success: boolean): void {
    const metrics = this.metrics.get(processorType)
    if (!metrics) return

    if (metrics.latencies.length >= this.LATENCY_WINDOW_SIZE) {
      metrics.latencies.shift()
    }
    metrics.latencies.push(latency)

    metrics.totalCount++
    metrics.lastLatency = latency

    if (success) {
      metrics.successCount++
      metrics.consecutiveFailures = 0
    } else {
      metrics.consecutiveFailures++
      if (metrics.consecutiveFailures >= 3) {
        metrics.isCircuitOpen = true
        metrics.circuitOpenTime = Date.now()
      }
    }
  }

  private calculateAverageLatency(processorType: string): number {
    const latencies = this.metrics.get(processorType)?.latencies
    if (!latencies || latencies.length === 0) return 0
    return latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length
  }

  private calculateP95Latency(processorType: string): number {
    const latencies = this.metrics.get(processorType)?.latencies
    if (!latencies || latencies.length === 0) return 0

    if (latencies.length === 1) return latencies[0] ?? 0

    const sorted = latencies.slice().sort((a, b) => a - b)
    const index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)
    return sorted[index] ?? 0
  }


  private calculateBackoffDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 5000)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  getRoutingMetrics(): Record<string, RoutingMetrics> {
    const result: Record<string, RoutingMetrics> = {}

    for (const [processorType, metrics] of this.metrics) {
      const fee = processorType === 'default' ? 0.05 : 0.15
      const totalPayments = metrics.successCount
      const totalCost = totalPayments * fee

      result[processorType] = {
        p95Latency: this.calculateP95Latency(processorType),
        successRate: metrics.totalCount > 0 ? metrics.successCount / metrics.totalCount : 0,
        totalCost,
        paymentsPerSecond: totalPayments / Math.max(1, (Date.now() - this.startupTime) / 1000),
        avgLatency: this.calculateAverageLatency(processorType)
      }
    }

    return result
  }


  private startHealthChecker(): NodeJS.Timeout {
    return setInterval(async () => {
      const promises = Array.from(this.processors.values()).map(processor =>
        this.checkProcessorHealth(processor)
      )
      await Promise.allSettled(promises)
    }, 5000)
  }

  private async checkProcessorHealth(processor: PaymentProcessor): Promise<void> {
    const now = Date.now()
    if (now - processor.lastHealthCheck <= 4500) return

    processor.lastHealthCheck = now

    try {
      const response = await fetch(`${processor.url}/payments/service-health`, {
        signal: AbortSignal.timeout(1500)
      })

      if (response.ok) {
        const health = await response.json() as HealthCheckResponse
        processor.isHealthy = !health.failing
        processor.minResponseTime = health.minResponseTime
      } else {
        processor.isHealthy = false
      }
    } catch {
      processor.isHealthy = false
    }
  }

  getProcessor(type: string): PaymentProcessor | undefined {
    return this.processors.get(type)
  }

  resetMetrics(): void {
    for (const [, metrics] of this.metrics) {
      metrics.latencies.length = 0
      metrics.successCount = 0
      metrics.totalCount = 0
      metrics.lastLatency = 0
      metrics.isCircuitOpen = false
      metrics.circuitOpenTime = 0
      metrics.consecutiveFailures = 0
    }
  }

  destroy(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
    }
  }
}