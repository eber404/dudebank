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


export interface HealthCheckResponse {
  failing: boolean
  minResponseTime: number
}

export interface ProcessorHealth {
  failing: boolean
  minResponseTime: number
  lastChecked: number
}

export interface ProcessorScore {
  processor: PaymentProcessor
  score: number
  reasoning: string
}

export interface PaymentProcessorRequest {
  correlationId: string
  amount: number
  requestedAt: string
}

