export interface Timestamped {
  timestamp: number;
}

export class RingBuffer<T extends Timestamped> {
  private items: T[] = [];
  private head = 0;
  private count = 0;

  constructor(private readonly maxSize: number) {
    if (maxSize <= 0) throw new Error('RingBuffer maxSize must be > 0');
    this.items = new Array(maxSize);
  }

  push(item: T): void {
    if (this.count < this.maxSize) {
      this.items[(this.head + this.count) % this.maxSize] = item;
      this.count++;
    } else {
      this.items[this.head] = item;
      this.head = (this.head + 1) % this.maxSize;
    }
  }

  getAll(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) {
      out.push(this.items[(this.head + i) % this.maxSize]);
    }
    return out;
  }

  getWindow(ms: number, now: number = Date.now()): T[] {
    const cutoff = now - ms;
    return this.getAll().filter((it) => it.timestamp >= cutoff);
  }

  clear(): void {
    this.items = new Array(this.maxSize);
    this.head = 0;
    this.count = 0;
  }

  size(): number {
    return this.count;
  }
}

