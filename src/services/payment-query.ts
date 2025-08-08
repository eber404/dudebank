import type { PaymentSummary } from '@/types'
import { DatabaseService } from './database-service'

function roundToComercialAmount(amount: number) {
  return parseFloat(amount.toFixed(2))
}

export class PaymentQuery {
  private databaseService: DatabaseService

  constructor(databaseService: DatabaseService) {
    this.databaseService = databaseService
  }

  async getPaymentsSummary(from?: string, to?: string, localOnly = false): Promise<PaymentSummary> {
    // Get local data
    const localRes = this.databaseService.getDatabaseSummary(from, to)

    // If local only flag is set, return just local data
    if (localOnly) {
      return {
        default: {
          totalRequests: roundToComercialAmount(localRes.default.totalRequests),
          totalAmount: roundToComercialAmount(localRes.default.totalAmount),
        },
        fallback: {
          totalRequests: roundToComercialAmount(localRes.fallback.totalRequests),
          totalAmount: roundToComercialAmount(localRes.fallback.totalAmount),
        },
      }
    }

    // Get sibling instance data
    const currentInstance = parseInt(Bun.env.INSTANCE_ID || '1')
    const siblingInstance = currentInstance === 1 ? 2 : 1
    const siblingSocketPath = `/tmp/api_${siblingInstance}.sock`

    let siblingRes: PaymentSummary = {
      default: { totalRequests: 0, totalAmount: 0 },
      fallback: { totalRequests: 0, totalAmount: 0 },
    }

    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      params.set('local', 'true') // Force sibling to return only local data
      const query = params.toString() ? '?' + params.toString() : ''

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 1000)

      const response = await fetch(
        `http://localhost/payments-summary${query}`,
        {
          unix: siblingSocketPath,
          signal: controller.signal,
        }
      )

      clearTimeout(timeoutId)

      if (response.ok) {
        siblingRes = await response.json()
      }
    } catch (error) {
      console.warn(`Failed to get sibling data: ${error}`)
    }

    // Merge results
    return {
      default: {
        totalRequests: roundToComercialAmount(
          localRes.default.totalRequests + siblingRes.default.totalRequests
        ),
        totalAmount: roundToComercialAmount(
          localRes.default.totalAmount + siblingRes.default.totalAmount
        ),
      },
      fallback: {
        totalRequests: roundToComercialAmount(
          localRes.fallback.totalRequests + siblingRes.fallback.totalRequests
        ),
        totalAmount: roundToComercialAmount(
          localRes.fallback.totalAmount + siblingRes.fallback.totalAmount
        ),
      },
    }
  }
}