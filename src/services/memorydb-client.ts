import { config } from "@/config";
import type { ProcessedPayment, PaymentSummary } from "@/types";

export class MemoryDBClient {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = config.databaseUrl;
  }

  async persistPaymentsBatch(payments: ProcessedPayment[]): Promise<void> {
    if (payments.length === 0) return;

    const response = await fetch(`${this.baseUrl}/payments/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payments),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to persist payments batch: ${response.statusText}`,
      );
    }
  }

  async getDatabaseSummary(
    from?: string,
    to?: string,
  ): Promise<PaymentSummary> {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);

    const url = `${this.baseUrl}/payments-summary${params.toString() ? "?" + params.toString() : ""}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to get database summary: ${response.statusText}`);
    }

    return (await response.json()) as PaymentSummary;
  }

  async purgeDatabase(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/admin/purge`, {
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(`Failed to purge database: ${response.statusText}`);
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
