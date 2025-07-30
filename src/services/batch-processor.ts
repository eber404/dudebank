import { Mutex } from 'async-mutex'

type ProcessingCallbacks<T> = {
  onProcess?: (batch: T[]) => Promise<void> | void
}

type Config = {
  intervalMs: number
  batchSize: number
}

export class BatchProcessor {
  private readonly queue = new Map()
  private readonly mutex?: Mutex

  constructor(private config: Config) {
    this.mutex = new Mutex()
  }

  addToQueue<T>(key: string, item: T): void {
    this.queue.set(key, item)
  }

  async startBatchProcessor<T>(callback: ProcessingCallbacks<T>) {
    let priority = 0
    setInterval(async () => {
      if (!this.queue.size) return
      await this.mutex?.runExclusive(async () => {
        console.log({ priority })
        const batch = this.extractBatch<T>()
        if (!batch.length) return
        await callback?.onProcess?.(batch)
        priority++
      }, priority)
    }, this.config.intervalMs)
  }

  private extractBatch<T>(): T[] {
    const batch: T[] = []
    const entries = Array.from(this.queue.entries())
      .slice(0, this.config.batchSize)
      .filter(Boolean)
    for (const entry of entries) {
      const [key, value] = entry
      batch.push(value)
      this.queue.delete(key)
    }
    return batch
  }
}
