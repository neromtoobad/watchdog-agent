import { describe, it, expect, vi } from 'vitest';
import { evaluateAll } from '../src/engine/rules';
import { handleViolation } from '../src/engine/actions';
import type { WatchdogEvent, WatchdogRules } from '../src/index';
import type { RulesEvaluation } from '../src/engine/rules';

const RULES: WatchdogRules = {
  maxTradesPerHour: 5,
  maxPositionSizePercent: 25,
  maxDrawdownPercent: 10,
  maxConsecutiveLosses: 3,
  maxSignalOverridesPerHour: 3,
};
const NOW = 1_700_000_000_000;

describe('evaluateAll', () => {
  it('all-ok baseline', () => {
    const r = evaluateAll([], RULES, 10_000, NOW);
    expect(r.overall).toBe('ok');
    expect(r.metrics.length).toBe(5);
    expect(r.violations).toEqual([]);
    expect(r.timestamp).toBe(NOW);
  });

  it('picks worst-of as overall', () => {
    const events: WatchdogEvent[] = Array.from({ length: 6 }, (_, i) => ({
      timestamp: NOW - i * 1000,
      type: 'trade-open',
      payload: { sizeUsdt: 100 },
    }));
    const r = evaluateAll(events, RULES, 10_000, NOW);
    expect(r.overall).toBe('violation');
    expect(r.violations.some((v) => v.startsWith('frequency:'))).toBe(true);
  });

  it('warning bubbles up when no violation', () => {
    // 4 trades, threshold 5 → warning
    const events: WatchdogEvent[] = Array.from({ length: 4 }, (_, i) => ({
      timestamp: NOW - i * 1000,
      type: 'trade-open',
      payload: { sizeUsdt: 100 },
    }));
    const r = evaluateAll(events, RULES, 10_000, NOW);
    expect(r.overall).toBe('warning');
  });
});

describe('handleViolation', () => {
  const fakeStatus: RulesEvaluation = {
    timestamp: NOW,
    overall: 'violation',
    metrics: [],
    violations: ['frequency: x'],
  };

  it('log returns block:false and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let paused: boolean | null = null;
    const r = handleViolation('log', fakeStatus, (p) => (paused = p));
    expect(r).toEqual({ block: false, action: 'log', reasons: ['frequency: x'] });
    expect(paused).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('alert returns block:false and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = handleViolation('alert', fakeStatus, () => {});
    expect(r.block).toBe(false);
    expect(r.action).toBe('alert');
    warn.mockRestore();
  });

  it('pause returns block:true and triggers setPaused(true)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let paused = false;
    const r = handleViolation('pause', fakeStatus, (p) => (paused = p));
    expect(r.block).toBe(true);
    expect(r.action).toBe('pause');
    expect(paused).toBe(true);
    warn.mockRestore();
  });
});
