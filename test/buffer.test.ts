import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../src/store/buffer';

const NOW = 1_700_000_000_000;

describe('RingBuffer', () => {
  it('throws on bad size', () => {
    expect(() => new RingBuffer<{ timestamp: number }>(0)).toThrow();
  });

  it('push + getAll preserves insertion order', () => {
    const b = new RingBuffer<{ timestamp: number; v: number }>(5);
    [1, 2, 3].forEach((v) => b.push({ timestamp: NOW + v, v }));
    expect(b.getAll().map((i) => i.v)).toEqual([1, 2, 3]);
    expect(b.size()).toBe(3);
  });

  it('overflow drops oldest', () => {
    const b = new RingBuffer<{ timestamp: number; v: number }>(3);
    for (let v = 1; v <= 5; v++) b.push({ timestamp: NOW + v, v });
    expect(b.getAll().map((i) => i.v)).toEqual([3, 4, 5]);
  });

  it('getWindow filters by timestamp', () => {
    const b = new RingBuffer<{ timestamp: number; v: number }>(5);
    b.push({ timestamp: NOW - 60_000, v: 1 });
    b.push({ timestamp: NOW - 5_000, v: 2 });
    b.push({ timestamp: NOW - 1_000, v: 3 });
    expect(b.getWindow(10_000, NOW).map((i) => i.v)).toEqual([2, 3]);
    expect(b.getWindow(0, NOW)).toEqual([]);
    expect(b.getWindow(60 * 60 * 1000, NOW).length).toBe(3);
  });

  it('clear empties', () => {
    const b = new RingBuffer<{ timestamp: number; v: number }>(3);
    b.push({ timestamp: NOW, v: 1 });
    b.clear();
    expect(b.size()).toBe(0);
    expect(b.getAll()).toEqual([]);
  });

  it('getWindow defaults now to Date.now()', () => {
    const b = new RingBuffer<{ timestamp: number; v: number }>(3);
    b.push({ timestamp: Date.now(), v: 1 });
    expect(b.getWindow(5_000).length).toBe(1);
  });
});
