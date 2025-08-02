type Processor = 'default' | 'fallback'

interface StoredItem {
  timestamp: number
  value: number
  processor: Processor
}

export class MemoryStore {
  private static readonly TIMESTAMP_BYTES = 8
  private static readonly AMOUNT_BYTES = 4
  private static readonly PROCESSOR_BYTES = 1
  private static readonly BYTES_PER_ITEM =
    MemoryStore.TIMESTAMP_BYTES +
    MemoryStore.AMOUNT_BYTES +
    MemoryStore.PROCESSOR_BYTES

  private static readonly TIMESTAMP_OFFSET = 0
  private static readonly AMOUNT_OFFSET = MemoryStore.TIMESTAMP_BYTES
  private static readonly PROCESSOR_OFFSET =
    MemoryStore.TIMESTAMP_BYTES + MemoryStore.AMOUNT_BYTES

  private readonly buffer: ArrayBuffer
  private readonly view: DataView
  private writeIndex = 0
  private itemCount = 0

  constructor(private readonly capacity: number = 17000) {
    this.buffer = new ArrayBuffer(capacity * MemoryStore.BYTES_PER_ITEM)
    this.view = new DataView(this.buffer)
  }

  add(timestampMs: number, value: number, processor: Processor) {
    const offset = this.writeIndex * MemoryStore.BYTES_PER_ITEM

    const scaledValue = Math.round(value * 100)
    const processorByte = processor === 'fallback' ? 1 : 0

    this.view.setBigUint64(
      offset + MemoryStore.TIMESTAMP_OFFSET,
      BigInt(timestampMs)
    )
    this.view.setUint32(offset + MemoryStore.AMOUNT_OFFSET, scaledValue)
    this.view.setUint8(offset + MemoryStore.PROCESSOR_OFFSET, processorByte)

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

      const timestamp = Number(
        this.view.getBigUint64(offset + MemoryStore.TIMESTAMP_OFFSET)
      )
      const scaledValue = this.view.getUint32(
        offset + MemoryStore.AMOUNT_OFFSET
      )
      const processorByte = this.view.getUint8(
        offset + MemoryStore.PROCESSOR_OFFSET
      )

      result.push({
        timestamp,
        value: scaledValue / 100,
        processor: processorByte === 1 ? 'fallback' : 'default',
      })
    }

    return result
  }

  async clear(): Promise<void> {
    this.writeIndex = 0
    this.itemCount = 0
  }
}
