import { describe, it, expect } from 'vitest';
import { evaluateDrawdown } from '../src/metrics/drawdown';
import type { WatchdogEvent, WatchdogRules } from '../src/index';

const rules: WatchdogRules = {
  maxTradesPerHour: 10,
  maxPositionSizePercent: 25,
  maxDrawdownPercent: 10,
  maxConsecutiveLosses: 4,
  maxSignalOverridesPerHour: 3,
};

const NOW = 1_700_000_000_000;
const PORTFOLIO = 10_000;

function closes(pnls: number[]): WatchdogEvent[] {
  return pnls.map((pnl, i) => ({
    timestamp: NOW - (pnls.length - i) * 1000,
    type: 'trade-close',
    payload: { symbol: 'BTCUSDT', pnlUsdt: pnl },
  }));
}

describe('evaluateDrawdown', () => {
  it('ok with no closes (zero drawdown)', () => {
    const r = evaluateDrawdown([], rules, PORTFOLIO, NOW);
    expect(r.name).toBe('drawdown');
    expect(r.value).toBe(0);
    expect(r.status).toBe('ok');
  });

  it('ok when only gains (peak keeps rising)', () => {
    const r = evaluateDrawdown(closes([100, 200, 300]), rules, PORTFOLIO, NOW);
    expect(r.value).toBe(0);
    expect(r.status).toBe('ok');
  });

  it('computes drawdown from peak after losses', () => {
    // peak = 10000 + 1000 = 11000; current = 11000 - 550 = 10450; dd = 5%
    const r = evaluateDrawdown(closes([1000, -300, -250]), rules, PORTFOLIO, NOW);
    expect(r.value).toBeCloseTo(5, 4);
    expect(r.status).toBe('ok');
  });

  it('warning at 70% of threshold', () => {
    // peak = 10000; current = 9300; dd = 7%; threshold 10% → warning
    const r = evaluateDrawdown(closes([-700]), rules, PORTFOLIO, NOW);
    expect(r.value).toBeCloseTo(7, 4);
    expect(r.status).toBe('warning');
  });

  it('violation above threshold', () => {
    // peak = 10000; current = 8800; dd = 12%; threshold 10% → violation
    const r = evaluateDrawdown(closes([-1200]), rules, PORTFOLIO, NOW);
    expect(r.value).toBeCloseTo(12, 4);
    expect(r.status).toBe('violation');
  });

  it('uses highest peak ever, not most recent', () => {
    // path: 10000 → 11000 (peak) → 10500 → 10200 → 9700
    // dd = (11000 - 9700) / 11000 * 100 = 11.818...
    const r = evaluateDrawdown(closes([1000, -500, -300, -500]), rules, PORTFOLIO, NOW);
    expect(r.value).toBeGreaterThan(10);
    expect(r.status).toBe('violation');
  });

  it('ignores non-close events', () => {
    const mix: WatchdogEvent[] = [
      ...closes([-700]),
      { timestamp: NOW - 1, type: 'trade-open', payload: { sizeUsdt: 9999 } },
      { timestamp: NOW, type: 'signal', payload: { signal: 'bearish', action: 'open-long' } },
    ];
    const r = evaluateDrawdown(mix, rules, PORTFOLIO, NOW);
    expect(r.value).toBeCloseTo(7, 4);
  });
});
