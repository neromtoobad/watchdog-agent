import { describe, it, expect } from 'vitest';
import { evaluateSignalOverride } from '../src/metrics/signalOverride';
import type { WatchdogEvent, WatchdogRules } from '../src/index';

const rules: WatchdogRules = {
  maxTradesPerHour: 10,
  maxPositionSizePercent: 25,
  maxDrawdownPercent: 10,
  maxConsecutiveLosses: 4,
  maxSignalOverridesPerHour: 10,
};

const NOW = 1_700_000_000_000;

function signal(signal: string, action: string, offsetMsAgo = 1000): WatchdogEvent {
  return {
    timestamp: NOW - offsetMsAgo,
    type: 'signal',
    payload: { signal, action },
  };
}

describe('evaluateSignalOverride', () => {
  it('ok with no signals', () => {
    const r = evaluateSignalOverride([], rules, NOW);
    expect(r.name).toBe('signalOverride');
    expect(r.value).toBe(0);
    expect(r.status).toBe('ok');
  });

  it('aligned signal and action is NOT a conflict', () => {
    const evs = [signal('bullish', 'open-long'), signal('bearish', 'open-short')];
    const r = evaluateSignalOverride(evs, rules, NOW);
    expect(r.value).toBe(0);
    expect(r.status).toBe('ok');
  });

  it('counts bearish + open-long as a conflict', () => {
    const evs = [signal('bearish', 'open-long')];
    const r = evaluateSignalOverride(evs, rules, NOW);
    expect(r.value).toBe(1);
  });

  it('counts bullish + open-short as a conflict', () => {
    const evs = [signal('bullish', 'open-short')];
    const r = evaluateSignalOverride(evs, rules, NOW);
    expect(r.value).toBe(1);
  });

  it('neutral signal is never a conflict', () => {
    const evs = [signal('neutral', 'open-long'), signal('neutral', 'open-short')];
    const r = evaluateSignalOverride(evs, rules, NOW);
    expect(r.value).toBe(0);
  });

  it('warning at 70% of threshold', () => {
    const evs = Array.from({ length: 7 }, (_, i) => signal('bearish', 'open-long', i * 100));
    const r = evaluateSignalOverride(evs, rules, NOW);
    expect(r.value).toBe(7);
    expect(r.status).toBe('warning');
  });

  it('violation above threshold', () => {
    const evs = Array.from({ length: 11 }, (_, i) => signal('bearish', 'open-long', i * 100));
    const r = evaluateSignalOverride(evs, rules, NOW);
    expect(r.value).toBe(11);
    expect(r.status).toBe('violation');
  });

  it('ignores signals older than 1 hour', () => {
    const recent = [signal('bearish', 'open-long', 500)];
    const old = Array.from({ length: 20 }, (_, i) =>
      signal('bearish', 'open-long', 60 * 60 * 1000 + 1 + i * 1000),
    );
    const r = evaluateSignalOverride([...old, ...recent], rules, NOW);
    expect(r.value).toBe(1);
    expect(r.status).toBe('ok');
  });

  it('ignores non-signal events', () => {
    const evs: WatchdogEvent[] = [
      signal('bearish', 'open-long'),
      { timestamp: NOW - 1000, type: 'trade-open', payload: { sizeUsdt: 100 } },
      { timestamp: NOW - 500, type: 'trade-close', payload: { pnlUsdt: -10 } },
    ];
    const r = evaluateSignalOverride(evs, rules, NOW);
    expect(r.value).toBe(1);
  });
});
