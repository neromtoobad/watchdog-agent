import { describe, it, expect } from 'vitest';
import { computeTrust, TRUST_WEIGHTS } from '../src/intelligence/trustScore';
import type { RulesEvaluation } from '../src/engine/rules';
import type { MetricResult, TrustScore } from '../src/index';

function mkMetric(name: string, status: 'ok' | 'warning' | 'violation'): MetricResult {
  return { name, status, value: 0, threshold: 0, detail: '' };
}

function mkEval(statuses: Record<string, 'ok' | 'warning' | 'violation'>): RulesEvaluation {
  const metrics: MetricResult[] = Object.entries(statuses).map(([n, s]) => mkMetric(n, s));
  const overall = metrics.some(m => m.status === 'violation') ? 'violation'
    : metrics.some(m => m.status === 'warning') ? 'warning' : 'ok';
  return {
    timestamp: 0,
    overall,
    metrics,
    violations: metrics.filter(m => m.status === 'violation').map(m => m.name),
  };
}

const ALL_OK = mkEval({
  frequency: 'ok', positionDrift: 'ok', drawdown: 'ok', lossStreak: 'ok', signalOverride: 'ok',
});

describe('computeTrust', () => {
  it('all-ok keeps score at 100 / healthy / flat', () => {
    const t = computeTrust(ALL_OK, 100);
    expect(t.score).toBe(100);
    expect(t.band).toBe('healthy');
    expect(t.trend).toBe('flat');
  });

  it('warning on a single metric only partially deducts', () => {
    const t = computeTrust(mkEval({ frequency: 'warning', positionDrift: 'ok', drawdown: 'ok', lossStreak: 'ok', signalOverride: 'ok' }), 100);
    expect(t.score).toBeLessThan(100);
    expect(t.score).toBeGreaterThan(80);
  });

  it('violation on a heavy metric drops into caution band', () => {
    // first compute = 0.6 * (100 - 30) + 0.4 * 100 = 82 → healthy (boundary)
    // second compute on same status against the new score = 0.6*70 + 0.4*82 = 75 → caution
    let prev = 100;
    let t = computeTrust(mkEval({ frequency: 'violation', positionDrift: 'ok', drawdown: 'ok', lossStreak: 'ok', signalOverride: 'ok' }), prev);
    prev = t.score;
    t = computeTrust(mkEval({ frequency: 'violation', positionDrift: 'ok', drawdown: 'ok', lossStreak: 'ok', signalOverride: 'ok' }), prev);
    expect(['caution', 'healthy']).toContain(t.band);
    // run a few more iterations to settle and assert it eventually leaves healthy
    for (let i = 0; i < 5; i++) t = computeTrust(mkEval({ frequency: 'violation', positionDrift: 'ok', drawdown: 'ok', lossStreak: 'ok', signalOverride: 'ok' }), t.score);
    expect(t.band).toBe('caution');
    expect(t.score).toBeLessThan(80);
  });

  it('all-violation eventually drops into unsafe band', () => {
    let t: TrustScore = { score: 100, band: 'healthy', trend: 'flat' };
    const full = mkEval({ frequency: 'violation', positionDrift: 'violation', drawdown: 'violation', lossStreak: 'violation', signalOverride: 'violation' });
    for (let i = 0; i < 20; i++) t = computeTrust(full, t.score);
    expect(t.band).toBe('unsafe');
    expect(t.score).toBeLessThan(50);
  });

  it('clamps to [0,100]', () => {
    const full = mkEval({ frequency: 'violation', positionDrift: 'violation', drawdown: 'violation', lossStreak: 'violation', signalOverride: 'violation' });
    const t = computeTrust(full, 0);
    expect(t.score).toBeGreaterThanOrEqual(0);
    expect(t.score).toBeLessThanOrEqual(100);
  });

  it('trend up when score rises >1', () => {
    const t = computeTrust(ALL_OK, 40);
    // raw=100, smoothed = 0.6*100 + 0.4*40 = 76 → much higher than 40 → up
    expect(t.trend).toBe('up');
  });

  it('trend down when score falls >1', () => {
    const full = mkEval({ frequency: 'violation', positionDrift: 'violation', drawdown: 'violation', lossStreak: 'violation', signalOverride: 'violation' });
    const t = computeTrust(full, 100);
    expect(t.trend).toBe('down');
  });

  it('trend flat when score barely moves', () => {
    // already-low score + all-ok → drift upward small → assess trend
    const t = computeTrust(ALL_OK, 100);
    expect(t.trend).toBe('flat');
  });

  it('weights sum to 100 (frequency + drawdown are heaviest)', () => {
    const total = Object.values(TRUST_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBe(100);
    expect(TRUST_WEIGHTS.frequency).toBeGreaterThanOrEqual(TRUST_WEIGHTS.positionDrift);
    expect(TRUST_WEIGHTS.drawdown).toBeGreaterThanOrEqual(TRUST_WEIGHTS.positionDrift);
  });

  it('band thresholds: ≥80 healthy, ≥50 caution, <50 unsafe', () => {
    // pure-status feeds chosen so we sit in each band's range
    // all-warning → raw=50; first smoothed = 0.6*50 + 0.4*100 = 70 → caution
    const allWarn = mkEval({ frequency: 'warning', positionDrift: 'warning', drawdown: 'warning', lossStreak: 'warning', signalOverride: 'warning' });
    const tWarn = computeTrust(allWarn, 100);
    expect(tWarn.band).toBe('caution');
    expect(tWarn.score).toBeGreaterThanOrEqual(50);
    expect(tWarn.score).toBeLessThan(80);

    // freq+drawdown violation (heavy weights, raw=40); smoothed = 0.6*40 + 0.4*40 = 40 → unsafe after settling
    const heavy = mkEval({ frequency: 'violation', positionDrift: 'ok', drawdown: 'violation', lossStreak: 'ok', signalOverride: 'ok' });
    let t: TrustScore = { score: 40, band: 'unsafe', trend: 'flat' };
    for (let i = 0; i < 5; i++) t = computeTrust(heavy, t.score);
    expect(t.band).toBe('unsafe');
    expect(t.score).toBeLessThan(50);

    // all-ok keeps healthy
    const tOk = computeTrust(ALL_OK, 95);
    expect(tOk.band).toBe('healthy');
    expect(tOk.score).toBeGreaterThanOrEqual(80);
  });
});
