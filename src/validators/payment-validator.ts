import type { PaymentRequest } from '@/types'

export class PaymentValidator {
  private static readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  static validatePaymentRequest(payment: PaymentRequest): string | null {
    if (!this.UUID_REGEX.test(payment.correlationId)) {
      return 'Invalid correlationId format'
    }
    return null
  }
}