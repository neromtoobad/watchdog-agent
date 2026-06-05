import { describe, it, expect } from 'vitest';
import { evaluateLossStreak } from '../src/metrics/lossStreak';
import type { WatchdogEvent, WatchdogRules } from '../src/index';

const rules: WatchdogRules = {
  maxTradesPerHour: 10,
  maxPositionSizePercent: 25,
  maxDrawdownPercent: 15,
  maxConsecutiveLosses: 4,
  maxSignalOverridesPerHour: 3,
};

const NOW = 1_700_000_000_000;

function closes(pnls: number[]): WatchdogEvent[] {
  return pnls.map((pnl, i) => ({
    timestamp: NOW - (pnls.length - i) * 1000,
    type: 'trade-close',
    payload: { symbol: 'BTCUSDT', pnlUsdt: pnl },
  }));
}

describe('evaluateLossStreak', () => {
  it('ok with no closes', () => {
    const r = evaluateLossStreak([], rules, NOW);
    expect(r.name).toBe('lossStreak');
    expect(r.status).toBe('ok');
    expect(r.value).toBe(0);
    expect(r.threshold).toBe(4);
  });

  it('ok with one loss', () => {
    const r = evaluateLossStreak(closes([-5]), rules, NOW);
    expect(r.status).toBe('ok');
    expect(r.value).toBe(1);
  });

  it('ok at threshold - 2 (two losses)', () => {
    const r = evaluateLossStreak(closes([-1, -2]), rules, NOW);
    expect(r.status).toBe('ok');
    expect(r.value).toBe(2);
  });

  it('warning at threshold - 1', () => {
    const r = evaluateLossStreak(closes([-1, -2, -3]), rules, NOW);
    expect(r.status).toBe('warning');
    expect(r.value).toBe(3);
  });

  it('violation at threshold', () => {
    const r = evaluateLossStreak(closes([-1, -2, -3, -4]), rules, NOW);
    expect(r.status).toBe('violation');
    expect(r.value).toBe(4);
  });

  it('violation beyond threshold counts whole streak', () => {
    const r = evaluateLossStreak(closes([-1, -2, -3, -4, -5]), rules, NOW);
    expect(r.status).toBe('violation');
    expect(r.value).toBe(5);
  });

  it('resets to 0 on a win (newest is positive)', () => {
    const r = evaluateLossStreak(closes([-1, -2, -3, 10]), rules, NOW);
    expect(r.status).toBe('ok');
    expect(r.value).toBe(0);
  });

  it('counts only newest contiguous losing run', () => {
    const r = evaluateLossStreak(closes([-9, -9, 5, -1, -2]), rules, NOW);
    expect(r.value).toBe(2);
    expect(r.status).toBe('ok');
  });

  it('zero pnl is treated as not-a-loss (breaks streak)', () => {
    const r = evaluateLossStreak(closes([-1, -1, -1, 0]), rules, NOW);
    expect(r.value).toBe(0);
    expect(r.status).toBe('ok');
  });

  it('ignores non-close events interleaved', () => {
    const evs: WatchdogEvent[] = [
      ...closes([-1, -2]),
      { timestamp: NOW - 500, type: 'signal', payload: { signal: 'bearish', action: 'open-long' } },
      ...closes([-3]),
    ];
    const r = evaluateLossStreak(evs, rules, NOW);
    expect(r.value).toBe(3);
    expect(r.status).toBe('warning');
  });
});
