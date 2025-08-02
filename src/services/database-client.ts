import { config } from '@/config'
import type { ProcessedPayment, PaymentSummary } from '@/types'

interface BatchItem {
  payments: ProcessedPayment[]
  resolve: () => void
  reject: (error: Error) => void
}

export class DatabaseClient {
  private readonly socketPath: string
  private batchQueue: BatchItem[] = []
  private batchTimer: Timer | null = null
  private readonly batchSize = config.databaseClient.batchSize
  private readonly batchTimeout = config.databaseClient.batchTimeoutMs

  constructor() {
    this.socketPath = config.databaseSocketPath
  }

  private async sendHttpRequest(
    path: string,
    method = 'GET',
    body?: any
  ): Promise<any> {
    const response = await fetch(`http://localhost${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      unix: this.socketPath,
    })

    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`)
    }

    return method === 'DELETE' ? null : await response.json()
  }

  private async flushBatch() {
    if (this.batchQueue.length === 0) return

    const currentBatch = this.batchQueue.splice(0, this.batchQueue.length)

    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    try {
      const allPayments = currentBatch.flatMap((item) => item.payments)

      if (allPayments.length > 0) {
        await this.sendHttpRequest('/payments/batch', 'POST', allPayments)
      }

      currentBatch.forEach((item) => item.resolve())
    } catch (error) {
      currentBatch.forEach((item) => item.reject(error as Error))
    }
  }

  private scheduleBatchFlush() {
    if (this.batchTimer) return

    this.batchTimer = setTimeout(() => {
      this.flushBatch()
    }, this.batchTimeout)
  }

  async persistPaymentsBatch(payments: ProcessedPayment[]): Promise<void> {
    if (!payments.length) return

    return new Promise((resolve, reject) => {
      this.batchQueue.push({
        payments,
        resolve,
        reject,
      })

      if (this.batchQueue.length >= this.batchSize) {
        this.flushBatch()
      } else {
        this.scheduleBatchFlush()
      }
    })
  }

  async getDatabaseSummary(
    from?: string,
    to?: string
  ): Promise<PaymentSummary> {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const query = params.toString() ? '?' + params.toString() : ''
    return await this.sendHttpRequest(`/payments-summary${query}`)
  }

  async purgeDatabase(): Promise<void> {
    await this.sendHttpRequest('/admin/purge', 'DELETE')
  }
}
