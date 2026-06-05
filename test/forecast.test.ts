import { describe, it, expect } from 'vitest';
import { forecastBreaches, appendHistory, FORECAST_HORIZON } from '../src/intelligence/forecast';
import type { WatchdogRules } from '../src/index';

const RULES: WatchdogRules = {
  maxTradesPerHour: 10,
  maxPositionSizePercent: 25,
  maxDrawdownPercent: 10,
  maxConsecutiveLosses: 4,
  maxSignalOverridesPerHour: 3,
};

describe('forecastBreaches', () => {
  it('returns no forecast with too few samples', () => {
    const r = forecastBreaches({ drawdown: [1, 2] }, RULES);
    expect(r).toEqual([]);
  });

  it('returns no forecast for flat history', () => {
    const r = forecastBreaches({ drawdown: [3, 3, 3, 3, 3] }, RULES);
    expect(r).toEqual([]);
  });

  it('returns no forecast for improving (negative slope) history', () => {
    const r = forecastBreaches({ drawdown: [5, 4, 3, 2, 1] }, RULES);
    expect(r).toEqual([]);
  });

  it('projects a drawdown breach within the horizon', () => {
    // slope 2.5, threshold 10 → from [2.5,5,7.5] breach in ~1
    const r = forecastBreaches({ drawdown: [2.5, 5, 7.5] }, RULES);
    expect(r.length).toBe(1);
    expect(r[0].metric).toBe('drawdown');
    expect(r[0].breachInTrades).toBe(1);
    expect(r[0].projection).toBeGreaterThanOrEqual(10);
  });

  it('skips forecast when metric is already over threshold', () => {
    const r = forecastBreaches({ drawdown: [8, 10, 12, 14] }, RULES);
    expect(r).toEqual([]);
  });

  it('ignores metrics without a configured threshold', () => {
    const r = forecastBreaches({ mysteryMetric: [1, 2, 3, 4] }, RULES);
    expect(r).toEqual([]);
  });

  it('forecasts multiple metrics independently', () => {
    const r = forecastBreaches({
      drawdown: [2, 4, 6],
      frequency: [3, 5, 7],
    }, RULES);
    const metrics = r.map((f) => f.metric).sort();
    expect(metrics).toEqual(['drawdown', 'frequency']);
  });

  it('drops forecasts beyond the horizon', () => {
    // slope=0.1, threshold=10, current=1 → ~90 trades to breach — past horizon
    const r = forecastBreaches({ drawdown: [0.9, 1.0, 1.1, 1.2, 1.3] }, RULES);
    expect(r.length).toBe(0);
  });

  it('respects custom horizon', () => {
    // breach in ~1 trade — fits a horizon of 1, also fits 8
    const r1 = forecastBreaches({ drawdown: [2.5, 5, 7.5] }, RULES, 1);
    const r8 = forecastBreaches({ drawdown: [2.5, 5, 7.5] }, RULES, 8);
    expect(r1.length).toBe(1);
    expect(r8.length).toBe(1);
  });

  it('FORECAST_HORIZON is the documented default (~8)', () => {
    expect(FORECAST_HORIZON).toBe(8);
  });
});

describe('appendHistory', () => {
  it('appends a value', () => {
    const h: Record<string, number[]> = {};
    appendHistory(h, 'drawdown', 1.5);
    appendHistory(h, 'drawdown', 2.5);
    expect(h.drawdown).toEqual([1.5, 2.5]);
  });

  it('caps the buffer at cap size', () => {
    const h: Record<string, number[]> = {};
    for (let i = 0; i < 50; i++) appendHistory(h, 'drawdown', i, 10);
    expect(h.drawdown.length).toBe(10);
    expect(h.drawdown[0]).toBe(40); // oldest kept = 50 - 10 = 40
    expect(h.drawdown[9]).toBe(49);
  });
});
