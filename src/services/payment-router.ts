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


export class PaymentRouter {
  private processors: Map<string, PaymentProcessor>
  private metrics: Map<string, LatencyMetrics>
  private readonly LATENCY_WINDOW_SIZE = 20
  private readonly DEFAULT_THRESHOLD = 100
  private readonly FALLBACK_THRESHOLD = 150
  private readonly HYSTERESIS_THRESHOLD = 80
  private readonly CIRCUIT_BREAKER_TIMEOUT = 5000
  private readonly CIRCUIT_RECOVERY_TIME = 15000
  private readonly LATENCY_MULTIPLIER_THRESHOLD = 2
  private readonly COST_BENEFIT_THRESHOLD = 1.5
  private readonly healthCheckInterval: NodeJS.Timeout

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
    const fallbackProcessor = this.processors.get('fallback')!
    const defaultMetrics = this.metrics.get('default')!
    const fallbackMetrics = this.metrics.get('fallback')!

    // Circuit breaker check with adaptive recovery
    if (defaultMetrics.isCircuitOpen) {
      const timeSinceOpen = Date.now() - defaultMetrics.circuitOpenTime
      if (timeSinceOpen <= this.CIRCUIT_RECOVERY_TIME) {
        return fallbackProcessor
      }
      // Try to recover gradually
      if (Math.random() > 0.7) {
        defaultMetrics.isCircuitOpen = false
      } else {
        return fallbackProcessor
      }
    }

    // Health check priority
    if (!defaultProcessor.isHealthy) {
      return fallbackProcessor
    }

    // If fallback is also unhealthy, prefer default (lower fee)
    if (!fallbackProcessor.isHealthy) {
      return defaultProcessor
    }

    // Use minResponseTime for smarter thresholds
    const dynamicThreshold = Math.max(
      this.DEFAULT_THRESHOLD,
      defaultProcessor.minResponseTime * 1.2
    )

    const defaultLatencies = defaultMetrics.latencies
    const fallbackLatencies = fallbackMetrics.latencies

    // No data yet, prefer default (lower fee)
    if (defaultLatencies.length === 0) {
      return defaultProcessor
    }

    const defaultAvgLatency = defaultLatencies.reduce((a, b) => a + b, 0) / defaultLatencies.length

    // If default is performing well, use it
    if (defaultAvgLatency <= dynamicThreshold && defaultMetrics.consecutiveFailures === 0) {
      return defaultProcessor
    }

    // Cost-benefit analysis
    if (fallbackLatencies.length > 0) {
      const fallbackAvgLatency = fallbackLatencies.reduce((a, b) => a + b, 0) / fallbackLatencies.length

      // Only switch if significant latency improvement
      const latencySaved = defaultAvgLatency - fallbackAvgLatency
      if (latencySaved > 50) {
        return fallbackProcessor
      }

      // Or if default is significantly worse
      if (defaultAvgLatency > this.LATENCY_MULTIPLIER_THRESHOLD * fallbackAvgLatency) {
        return fallbackProcessor
      }
    }

    // Consider minResponseTime differences
    if (fallbackProcessor.minResponseTime > 0 && defaultProcessor.minResponseTime > 0) {
      const minTimeRatio = defaultProcessor.minResponseTime / fallbackProcessor.minResponseTime
      if (minTimeRatio > 2.0) {
        return fallbackProcessor
      }
    }

    // Extreme latency fallback
    if (defaultAvgLatency > this.FALLBACK_THRESHOLD) {
      return fallbackProcessor
    }

    // Default preference (lower fee)
    return defaultProcessor
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

      // Better error handling for AbortError
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.CIRCUIT_BREAKER_TIMEOUT}ms to ${processor.type} processor`)
      }

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
      // More aggressive circuit breaker for faster adaptation
      if (metrics.consecutiveFailures >= 2) {
        metrics.isCircuitOpen = true
        metrics.circuitOpenTime = Date.now()
      }
    }
  }



  private calculateBackoffDelay(attempt: number): number {
    return Math.min(1000 * Math.pow(2, attempt), 5000)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }



  private startHealthChecker(): NodeJS.Timeout {
    return setInterval(async () => {
      const promises = Array.from(this.processors.values()).map(processor =>
        this.checkProcessorHealth(processor)
      )
      await Promise.allSettled(promises)
    }, config.processing.healthCheckIntervalMs)
  }

  private async checkProcessorHealth(processor: PaymentProcessor): Promise<void> {
    processor.lastHealthCheck = Date.now()

    try {
      const response = await fetch(`${processor.url}/payments/service-health`, {
        signal: AbortSignal.timeout(config.processing.healthCheckTimeoutMs)
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