import { config } from '@/config'
import type { ProcessedPayment, PaymentSummary } from '@/types'

import { Queue } from './queue-service'

interface BatchItem {
  payments: ProcessedPayment[]
  resolve: () => void
  reject: (error: Error) => void
}

export class DatabaseClient {
  private readonly socketPath: string
  private batchQueue: Queue<BatchItem>
  private batchTimer: Timer | null = null
  private readonly batchSize = config.databaseClient.batchSize
  private readonly batchTimeout = config.databaseClient.batchTimeoutMs

  constructor() {
    this.socketPath = config.databaseSocketPath
    this.batchQueue = new Queue<BatchItem>()
  }

  private async httpClient(
    path: string,
    method = 'GET',
    body: any = undefined
  ): Promise<any> {
    const response = await fetch(`http://localhost${path}`, {
      method,
      body: body && JSON.stringify(body),
      unix: this.socketPath,
    })

    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`)
    }

    return method === 'DELETE' ? null : await response.json()
  }

  private async flushBatch() {
    if (this.batchQueue.isEmpty) return

    const currentBatch: BatchItem[] = []
    while (!this.batchQueue.isEmpty) {
      const item = this.batchQueue.dequeue()
      if (item) currentBatch.push(item)
    }

    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }

    try {
      const allPayments = currentBatch.flatMap((item) => item.payments)

      if (allPayments.length > 0) {
        await this.httpClient('/payments/batch', 'POST', allPayments)
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
      this.batchQueue.enqueue({
        payments,
        resolve,
        reject,
      })

      if (this.batchQueue.size >= this.batchSize) {
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
    return await this.httpClient(`/payments-summary${query}`)
  }

  async purgeDatabase(): Promise<void> {
    await this.httpClient('/admin/purge', 'DELETE')
  }
}
