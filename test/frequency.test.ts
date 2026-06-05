import { describe, it, expect } from 'vitest';
import { evaluateFrequency } from '../src/metrics/frequency';
import type { WatchdogEvent, WatchdogRules } from '../src/index';

const rules: WatchdogRules = {
  maxTradesPerHour: 10,
  maxPositionSizePercent: 25,
  maxDrawdownPercent: 15,
  maxConsecutiveLosses: 4,
  maxSignalOverridesPerHour: 3,
};

const NOW = 1_700_000_000_000;

function openEvents(count: number, offsetMsEach = 60_000): WatchdogEvent[] {
  const out: WatchdogEvent[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ timestamp: NOW - i * offsetMsEach, type: 'trade-open', payload: {} });
  }
  return out;
}

describe('evaluateFrequency', () => {
  it('returns ok when below 70% of threshold', () => {
    const r = evaluateFrequency(openEvents(6), rules, NOW);
    expect(r.name).toBe('frequency');
    expect(r.status).toBe('ok');
    expect(r.value).toBe(6);
    expect(r.threshold).toBe(10);
  });

  it('transitions to warning at exactly 70% of threshold', () => {
    const r = evaluateFrequency(openEvents(7), rules, NOW);
    expect(r.status).toBe('warning');
    expect(r.value).toBe(7);
  });

  it('stays warning at threshold', () => {
    const r = evaluateFrequency(openEvents(10), rules, NOW);
    expect(r.status).toBe('warning');
    expect(r.value).toBe(10);
  });

  it('transitions to violation above threshold', () => {
    const r = evaluateFrequency(openEvents(11), rules, NOW);
    expect(r.status).toBe('violation');
    expect(r.value).toBe(11);
  });

  it('ignores trades older than 1 hour', () => {
    const recent = openEvents(5);
    const old: WatchdogEvent[] = Array.from({ length: 20 }, (_, i) => ({
      timestamp: NOW - 60 * 60 * 1000 - (i + 1) * 1000,
      type: 'trade-open',
      payload: {},
    }));
    const r = evaluateFrequency([...old, ...recent], rules, NOW);
    expect(r.value).toBe(5);
    expect(r.status).toBe('ok');
  });

  it('ignores non-trade-open events', () => {
    const mix: WatchdogEvent[] = [
      ...openEvents(5),
      { timestamp: NOW - 1000, type: 'trade-close', payload: { pnlUsdt: -10 } },
      { timestamp: NOW - 500, type: 'signal', payload: {} },
    ];
    const r = evaluateFrequency(mix, rules, NOW);
    expect(r.value).toBe(5);
  });
});
