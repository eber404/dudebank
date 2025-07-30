import { config } from '@/config'
import type { ProcessedPayment, PaymentSummary } from '@/types'

export class DatabaseClient {
  private readonly socketPath: string

  constructor() {
    this.socketPath = config.databaseSocketPath
  }

  async persistPaymentsBatch(payments: ProcessedPayment[]): Promise<void> {
    if (!payments.length) return

    const response = await fetch('http://localhost/payments/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payments),
      unix: this.socketPath,
    })

    if (!response.ok) {
      throw new Error(
        `Failed to persist payments batch: ${response.statusText}`
      )
    }
  }

  async getDatabaseSummary(
    from?: string,
    to?: string
  ): Promise<PaymentSummary> {
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)

    const url = `http://localhost/payments-summary${
      params.toString() ? '?' + params.toString() : ''
    }`
    const response = await fetch(url, {
      unix: this.socketPath,
    })

    if (!response.ok) {
      throw new Error(`Failed to get database summary: ${response.statusText}`)
    }

    return (await response.json()) as PaymentSummary
  }

  async purgeDatabase(): Promise<void> {
    const response = await fetch('http://localhost/admin/purge', {
      method: 'DELETE',
      unix: this.socketPath,
    })

    if (!response.ok) {
      throw new Error(`Failed to purge database: ${response.statusText}`)
    }
  }
}
