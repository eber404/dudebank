export interface PaymentRequest {
  correlationId: string;
  amount: number;
}

export type ProcessorType = "default" | "fallback";

export interface PaymentProcessor {
  url: string;
  type: ProcessorType;
}

export interface PaymentSummary {
  default: {
    totalRequests: number;
    totalAmount: number;
  };
  fallback: {
    totalRequests: number;
    totalAmount: number;
  };
}

export interface ProcessedPayment {
  correlationId: string;
  amount: number;
  processor: ProcessorType;
  requestedAt: string;
  status: string;
}

export interface HealthCheckResponse {
  failing: boolean;
  minResponseTime: number;
}

export interface ProcessorHealth {
  failing: boolean;
  minResponseTime: number;
  lastChecked: number;
}
export type ProcessorHealthStatus = Map<ProcessorType, ProcessorHealth>;

export interface PaymentProcessorRequest {
  correlationId: string;
  amount: number;
  requestedAt: string;
}
