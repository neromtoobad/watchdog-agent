import { describe, it, expect } from 'vitest';
import { BaselineTracker, BASELINE_CONST } from '../src/intelligence/baseline';

describe('BaselineTracker', () => {
  it('returns null for an unseen metric', () => {
    const b = new BaselineTracker();
    expect(b.baseline('frequency')).toBeNull();
  });

  it('reports sigma=null during warmup', () => {
    const b = new BaselineTracker();
    for (let i = 0; i < BASELINE_CONST.WARMUP - 1; i++) b.observe('frequency', 4);
    const bl = b.baseline('frequency');
    expect(bl).not.toBeNull();
    expect(bl!.sigma).toBeNull();
  });

  it('computes a sigma once warm and flags a clear anomaly', () => {
    const b = new BaselineTracker();
    // establish a normal of ~4 trades/hr
    for (let i = 0; i < 12; i++) b.observe('frequency', 4 + (i % 2 === 0 ? 0.2 : -0.2));
    // now a big spike
    b.observe('frequency', 40);
    const bl = b.baseline('frequency')!;
    expect(bl.sigma).not.toBeNull();
    expect(bl.sigma!).toBeGreaterThan(BASELINE_CONST.ANOMALY_SIGMA);
    expect(bl.anomaly).toBe(true);
    expect(bl.mean).toBeCloseTo(4, 0);
  });

  it('does not flag values within normal range', () => {
    const b = new BaselineTracker();
    for (let i = 0; i < 14; i++) b.observe('drawdown', 5 + Math.sin(i));
    b.observe('drawdown', 5.3);
    const bl = b.baseline('drawdown')!;
    expect(bl.anomaly).toBe(false);
    expect(Math.abs(bl.sigma!)).toBeLessThan(BASELINE_CONST.ANOMALY_SIGMA);
  });

  it('scores current against PRIOR normal, not a normal that includes the spike', () => {
    const b = new BaselineTracker();
    for (let i = 0; i < 12; i++) b.observe('positionDrift', 10);
    b.observe('positionDrift', 25);
    const bl = b.baseline('positionDrift')!;
    // baseline mean should be ~10 (prior), not pulled toward 25
    expect(bl.mean).toBeCloseTo(10, 1);
    expect(bl.current).toBe(25);
    expect(bl.anomaly).toBe(true);
  });

  it('handles a flat baseline without dividing by zero', () => {
    const b = new BaselineTracker();
    for (let i = 0; i < 12; i++) b.observe('lossStreak', 0);
    b.observe('lossStreak', 0);
    const bl = b.baseline('lossStreak')!;
    expect(bl.std).toBe(0);
    expect(bl.sigma).toBe(0);     // no movement → 0σ, not NaN/Infinity
    expect(bl.anomaly).toBe(false);
  });

  it('flat baseline then a jump reads as a strong anomaly', () => {
    const b = new BaselineTracker();
    for (let i = 0; i < 12; i++) b.observe('signalOverride', 0);
    b.observe('signalOverride', 5);
    const bl = b.baseline('signalOverride')!;
    expect(bl.anomaly).toBe(true);
  });

  it('topAnomaly returns the highest-|σ| warm metric', () => {
    const b = new BaselineTracker();
    // give both a small but non-zero spread so σ is finite and comparable
    for (let i = 0; i < 12; i++) {
      b.observe('frequency', 4 + (i % 2 ? 0.5 : -0.5));
      b.observe('drawdown', 5 + (i % 2 ? 0.5 : -0.5));
    }
    b.observe('frequency', 9);    // moderate deviation
    b.observe('drawdown', 40);    // huge deviation
    const top = b.topAnomaly();
    expect(top).not.toBeNull();
    expect(top!.metric).toBe('drawdown');
  });

  it('windows to the most recent samples', () => {
    const b = new BaselineTracker();
    for (let i = 0; i < BASELINE_CONST.WINDOW + 20; i++) b.observe('frequency', i);
    const bl = b.baseline('frequency')!;
    expect(bl.samples).toBeLessThanOrEqual(BASELINE_CONST.WINDOW);
  });

  it('clear wipes all series', () => {
    const b = new BaselineTracker();
    for (let i = 0; i < 12; i++) b.observe('frequency', 4);
    b.clear();
    expect(b.baseline('frequency')).toBeNull();
    expect(b.all()).toEqual([]);
  });
});
