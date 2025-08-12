import { config } from '@/config'
import type { ProcessedPayment, PaymentSummary } from '@/types'
import { encode } from '@msgpack/msgpack'

export class DatabaseClient {
  private readonly socketPath: string

  constructor() {
    this.socketPath = config.databaseSocketPath
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
      keepalive: true,
    })

    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`)
    }

    if (method === 'GET') {
      return response.json()
    }
    
    return null
  }

  async persistPaymentsBatch(payments: ProcessedPayment[]): Promise<void> {
    if (!payments.length) return
    
    // Usar MessagePack para serialização binária
    const msgpackData = encode(payments)
    
    const response = await fetch(`http://localhost/payments/batch`, {
      method: 'POST',
      body: new Uint8Array(msgpackData),
      unix: this.socketPath,
      keepalive: true,
      headers: {
        'Content-Type': 'application/msgpack'
      }
    })

    if (!response.ok) {
      throw new Error(`Request failed: ${response.statusText}`)
    }
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
