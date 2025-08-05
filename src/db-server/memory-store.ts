type Processor = 'default' | 'fallback'

interface StoredItem {
  timestamp: number
  value: number
  processor: Processor
}

export class MemoryStore {
  private readonly AMOUNT_MASK = 0x7ff
  private readonly TIMESTAMP_MASK = 0x1fffff

  private readonly createdAt: number
  private items: number[] = []

  constructor() {
    this.createdAt = Date.now()
  }

  private pack(amount: number, timestampMs: number): number {
    const cents = (amount * 100 + 0.5) | 0

    if (cents > this.AMOUNT_MASK) {
      throw new Error(
        `Amount muito alto: máximo R$ ${
          this.AMOUNT_MASK / 100
        } (atual: R$ ${amount})`
      )
    }

    const rel = timestampMs - this.createdAt

    if (rel < 0 || rel > this.TIMESTAMP_MASK) {
      throw new Error(
        `Timestamp fora do range: máximo ${this.TIMESTAMP_MASK}ms (~${(
          this.TIMESTAMP_MASK / 60000
        ).toFixed(1)} min)`
      )
    }

    return (rel << 11) | cents
  }

  private unpack(packed: number): { amount: number; timestamp: number } {
    const cents = packed & this.AMOUNT_MASK
    const rel = (packed >>> 11) & this.TIMESTAMP_MASK

    return {
      amount: cents * 0.01,
      timestamp: this.createdAt + rel,
    }
  }

  add(timestampMs: number, value: number) {
    const packed = this.pack(value, timestampMs)
    this.items.push(packed)
    console.log('add', new Date().toISOString())
  }

  getAll() {
    const result: StoredItem[] = []

    for (const packed of this.items) {
      const unpacked = this.unpack(packed)

      result.push({
        timestamp: unpacked.timestamp,
        value: unpacked.amount,
        processor: 'default',
      })
    }

    return result
  }

  async clear(): Promise<void> {
    this.items = []
  }
}
