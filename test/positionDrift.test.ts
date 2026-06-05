import { describe, it, expect } from 'vitest';
import { evaluatePositionDrift } from '../src/metrics/positionDrift';
import type { WatchdogEvent, WatchdogRules } from '../src/index';

const rules: WatchdogRules = {
  maxTradesPerHour: 10,
  maxPositionSizePercent: 20,
  maxDrawdownPercent: 10,
  maxConsecutiveLosses: 4,
  maxSignalOverridesPerHour: 3,
};

const NOW = 1_700_000_000_000;
const PORTFOLIO = 1000;

function opens(sizes: number[]): WatchdogEvent[] {
  return sizes.map((sizeUsdt, i) => ({
    timestamp: NOW - (sizes.length - i) * 1000,
    type: 'trade-open',
    payload: { type: 'open', symbol: 'BTCUSDT', sizeUsdt, direction: 'long' },
  }));
}

describe('evaluatePositionDrift', () => {
  it('ok with no opens', () => {
    const r = evaluatePositionDrift([], rules, PORTFOLIO, NOW);
    expect(r.name).toBe('positionDrift');
    expect(r.value).toBe(0);
    expect(r.status).toBe('ok');
  });

  it('ok with small avg position (5%)', () => {
    const r = evaluatePositionDrift(opens([50, 50, 50]), rules, PORTFOLIO, NOW);
    expect(r.value).toBeCloseTo(5, 4);
    expect(r.status).toBe('ok');
  });

  it('warning at 70% of threshold (avg 14% of 20%)', () => {
    const r = evaluatePositionDrift(opens([140, 140]), rules, PORTFOLIO, NOW);
    expect(r.value).toBeCloseTo(14, 4);
    expect(r.status).toBe('warning');
  });

  it('violation above threshold (avg 25% of 20%)', () => {
    const r = evaluatePositionDrift(opens([250]), rules, PORTFOLIO, NOW);
    expect(r.value).toBeCloseTo(25, 4);
    expect(r.status).toBe('violation');
  });

  it('uses average across recent opens', () => {
    // average of 100, 200, 300 = 200 → 20% → at threshold (not over) → warning
    const r = evaluatePositionDrift(opens([100, 200, 300]), rules, PORTFOLIO, NOW);
    expect(r.value).toBeCloseTo(20, 4);
    expect(r.status).toBe('warning');
  });

  it('windows to last 10 opens', () => {
    // 11 opens: first one is huge but should be dropped from the window of 10
    const sizes = [10_000, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
    const r = evaluatePositionDrift(opens(sizes), rules, PORTFOLIO, NOW);
    expect(r.value).toBeCloseTo(5, 4);
    expect(r.status).toBe('ok');
  });

  it('ignores non-open events', () => {
    const mix: WatchdogEvent[] = [
      ...opens([50]),
      { timestamp: NOW, type: 'trade-close', payload: { symbol: 'BTCUSDT', pnlUsdt: -10 } },
      { timestamp: NOW, type: 'signal', payload: { signal: 'bearish', action: 'open-long' } },
    ];
    const r = evaluatePositionDrift(mix, rules, PORTFOLIO, NOW);
    expect(r.value).toBeCloseTo(5, 4);
  });
});
