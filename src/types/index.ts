export interface PaymentRequest {
  correlationId: string
  amount: number
}

export type ProcessorType = 'default' | 'fallback'

export interface PaymentProcessor {
  url: string
  type: ProcessorType
}

export interface PaymentSummary {
  default: {
    totalRequests: number
    totalAmount: number
  }
  fallback: {
    totalRequests: number
    totalAmount: number
  }
}

export interface ProcessedPayment {
  correlationId: string
  amount: number
  processor: ProcessorType
  requestedAt: string
}

export interface PaymentProcessorRequest {
  correlationId: string
  amount: number
  requestedAt: string
}
