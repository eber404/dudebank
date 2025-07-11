export interface PaymentRequest {
  correlationId: string
  amount: number
}

export interface PaymentProcessor {
  url: string
  type: 'default' | 'fallback'
  isHealthy: boolean
  minResponseTime: number
  lastHealthCheck: number
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
  processor: string
  requestedAt: string
  status: string
}

export interface DatabaseRow {
  processor: string
  total_requests: string
  total_amount: string
}

export interface HealthCheckResponse {
  failing: boolean
  minResponseTime: number
}