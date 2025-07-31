export class Queue<T> {
  private _store: Record<number, T>
  private _head: number
  private _tail: number

  constructor() {
    this._store = {}
    this._head = 0
    this._tail = 0
  }

  enqueue(value: T): void {
    this._store[this._tail++] = value
  }

  dequeue(): T | undefined {
    if (this.isEmpty) return undefined

    const value = this._store[this._head]
    delete this._store[this._head++]
    return value
  }

  peek(): T | undefined {
    return this._store[this._head]
  }

  get size(): number {
    return this._tail - this._head
  }

  get isEmpty(): boolean {
    return this.size === 0
  }

  clear(): void {
    this._store = {}
    this._head = 0
    this._tail = 0
  }
}
