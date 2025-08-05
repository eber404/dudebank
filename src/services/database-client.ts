import { config } from '@/config'
import type { ProcessedPayment, PaymentSummary } from '@/types'

export class DatabaseClient {
  private readonly socketPath: string

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

  async persistPaymentsBatch(payments: ProcessedPayment[]): Promise<void> {
    if (!payments.length) return
    
    await this.sendHttpRequest('/payments/batch', 'POST', payments)
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
