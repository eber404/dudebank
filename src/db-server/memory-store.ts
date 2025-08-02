type Processor = 'default' | 'fallback'

interface StoredItem {
  timestamp: number
  value: number
  processor: Processor
}

export class MemoryStore {
  private static readonly TIMESTAMP_BYTES = 4
  private static readonly AMOUNT_BYTES = 4
  private static readonly BYTES_PER_ITEM =
    MemoryStore.TIMESTAMP_BYTES +
    MemoryStore.AMOUNT_BYTES

  private static readonly TIMESTAMP_OFFSET = 0
  private static readonly AMOUNT_OFFSET = MemoryStore.TIMESTAMP_BYTES

  private readonly buffer: ArrayBuffer
  private readonly view: DataView
  private readonly createdAt: number
  private writeIndex = 0
  private itemCount = 0

  constructor(private readonly capacity: number = 17000) {
    this.buffer = new ArrayBuffer(capacity * MemoryStore.BYTES_PER_ITEM)
    this.view = new DataView(this.buffer)
    this.createdAt = Date.now()
  }

  add(timestampMs: number, value: number) {
    const offset = this.writeIndex * MemoryStore.BYTES_PER_ITEM
    const scaledValue = Math.round(value * 100)
    const relativeTimestamp = timestampMs - this.createdAt

    this.view.setUint32(
      offset + MemoryStore.TIMESTAMP_OFFSET,
      relativeTimestamp
    )
    this.view.setUint32(offset + MemoryStore.AMOUNT_OFFSET, scaledValue)

    this.writeIndex = (this.writeIndex + 1) % this.capacity
    if (this.itemCount < this.capacity) {
      this.itemCount++
    }
  }

  getAll() {
    const result: StoredItem[] = []
    const isBufferFull = this.itemCount === this.capacity
    const readStartIndex = isBufferFull ? this.writeIndex : 0

    for (let i = 0; i < this.itemCount; i++) {
      const readIndex = (readStartIndex + i) % this.capacity
      const offset = readIndex * MemoryStore.BYTES_PER_ITEM

      const relativeTimestamp = this.view.getUint32(
        offset + MemoryStore.TIMESTAMP_OFFSET
      )
      const timestamp = this.createdAt + relativeTimestamp

      const scaledValue = this.view.getUint32(
        offset + MemoryStore.AMOUNT_OFFSET
      )

      result.push({
        timestamp,
        value: scaledValue / 100,
        processor: 'default',
      })
    }

    return result
  }

  async clear(): Promise<void> {
    this.writeIndex = 0
    this.itemCount = 0
  }
}
