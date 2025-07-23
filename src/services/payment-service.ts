import Decimal from "decimal.js";

import { config } from "@/config";
import type {
  PaymentRequest,
  PaymentSummary,
  ProcessedPayment,
  ProcessorType,
} from "@/types";

import { PaymentRouter } from "./payment-router";
import { MemoryDBClient } from "./memorydb-client";

export class PaymentService {
  private paymentRouter: PaymentRouter;
  private memoryDBClient: MemoryDBClient;
  private paymentQueue: Map<string, PaymentRequest> = new Map();
  private totalProcessed = 0;
  private totalReceived = 0;
  private isProcessingBatch = false;

  constructor() {
    this.paymentRouter = new PaymentRouter();
    this.memoryDBClient = new MemoryDBClient();

    this.startPaymentProcessor();
  }

  private startPaymentProcessor(): void {
    setInterval(async () => {
      if (this.isProcessingBatch || !this.paymentQueue.size) return;
      this.isProcessingBatch = true;
      try {
        const batch = this.extractBatch();
        if (batch.length > 0) {
          await this.processBatch(batch);
        }
      } finally {
        this.isProcessingBatch = false;
      }
    }, config.processing.batchIntervalMs);
  }

  private extractBatch(): PaymentRequest[] {
    const batch: PaymentRequest[] = [];
    const entries = Array.from(this.paymentQueue.entries());

    for (
      let i = 0;
      i < Math.min(config.processing.batchSize, entries.length);
      i++
    ) {
      const entry = entries[i];
      if (!entry) continue;
      const [correlationId, payment] = entry;
      batch.push(payment);
      this.paymentQueue.delete(correlationId);
    }

    return batch;
  }

  private async processBatch(payments: PaymentRequest[]): Promise<void> {
    const batchStartTime = Date.now();

    const promises = payments.map((payment) => this.processPayment(payment));
    const results = await Promise.allSettled(promises);

    const successfulPayments: ProcessedPayment[] = [];

    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;
      successfulPayments.push(result.value.processedPayment);
    }

    if (!successfulPayments.length) return;

    const dbStartTime = Date.now();
    await this.memoryDBClient.persistPaymentsBatch(successfulPayments);
    const dbTime = Date.now() - dbStartTime;

    const totalTime = Date.now() - batchStartTime;
    this.atomicIncrement("totalProcessed", successfulPayments.length);

    console.log(
      `Batch processed: ${successfulPayments.length}/${payments.length} payments | DB: ${dbTime}ms | Total: ${totalTime}ms | Queue: ${this.paymentQueue.size}`,
    );
  }

  private async processPayment(
    payment: PaymentRequest,
  ): Promise<{
    processedPayment: ProcessedPayment;
    processorType: ProcessorType;
  } | null> {
    try {
      const requestedAt = new Date().toISOString();
      const result = await this.paymentRouter.processPaymentWithRetry(
        payment,
        requestedAt,
      );

      if (!result.response.ok) return null;

      const processorType = result.processor.type;

      const processedPayment = {
        correlationId: payment.correlationId,
        amount: payment.amount,
        processor: processorType,
        requestedAt,
        status: "processed" as const,
      };

      return { processedPayment, processorType };
    } catch (error) {
      console.error("Error processing payment:", error);
      return null;
    }
  }

  private atomicIncrement(
    counter: "totalProcessed" | "totalReceived",
    amount: number = 1,
  ): void {
    if (counter === "totalProcessed") {
      this.totalProcessed += amount;
    }

    if (counter === "totalReceived") {
      this.totalReceived += amount;
    }
  }

  addPayment(payment: PaymentRequest): void {
    this.paymentQueue.set(payment.correlationId, payment);
    this.atomicIncrement("totalReceived");
  }

  async getPaymentsSummary(
    from?: string,
    to?: string,
  ): Promise<PaymentSummary> {
    try {
      const res = await this.memoryDBClient.getDatabaseSummary(from, to);

      const summary: PaymentSummary = {
        default: {
          totalRequests: this.roundToComercialAmount(res.default.totalRequests),
          totalAmount: this.roundToComercialAmount(res.default.totalAmount),
        },
        fallback: {
          totalRequests: this.roundToComercialAmount(
            res.fallback.totalRequests,
          ),
          totalAmount: this.roundToComercialAmount(res.fallback.totalAmount),
        },
      };

      return summary;
    } catch (error) {
      console.error("Error getting payments summary:", error);
      return {
        default: { totalRequests: 0, totalAmount: 0 },
        fallback: { totalRequests: 0, totalAmount: 0 },
      };
    }
  }

  private roundToComercialAmount(amount: number): number {
    return new Decimal(amount)
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toNumber();
  }

  async purgeAll(): Promise<{ database: boolean; queue: boolean }> {
    const results = {
      database: false,
      queue: false,
    };

    try {
      // Wait for any ongoing batch processing to complete
      while (this.isProcessingBatch) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      // Clear processing queue and reset stats atomically
      this.paymentQueue.clear();
      this.totalProcessed = 0;
      this.totalReceived = 0;
      results.queue = true;
      console.log("Payment queue and stats cleared");

      // Purge MemoryDB
      await this.memoryDBClient.purgeDatabase();
      results.database = true;

      console.log("Complete purge successful");
      return results;
    } catch (error) {
      console.error("Error during purge operation:", error);
      return results;
    }
  }
}
