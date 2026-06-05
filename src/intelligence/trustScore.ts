import type { TrustBand, TrustScore, TrustTrend } from '../index';
import type { RulesEvaluation } from '../engine/rules';

// weights total 100. frequency + drawdown carry the heaviest weight
// (the two most-destructive failure modes per CLAUDE.md).
export const TRUST_WEIGHTS: Record<string, number> = {
  frequency: 30,
  drawdown: 30,
  positionDrift: 15,
  lossStreak: 15,
  signalOverride: 10,
};

const EMA_NEW = 0.6;
const EMA_PREV = 0.4;
const TREND_EPSILON = 1; // points

function statusFactor(status: 'ok' | 'warning' | 'violation'): number {
  if (status === 'violation') return 1;
  if (status === 'warning') return 0.5;
  return 0;
}

function band(score: number): TrustBand {
  if (score >= 80) return 'healthy';
  if (score >= 50) return 'caution';
  return 'unsafe';
}

function trend(prev: number, next: number): TrustTrend {
  const diff = next - prev;
  if (diff > TREND_EPSILON) return 'up';
  if (diff < -TREND_EPSILON) return 'down';
  return 'flat';
}

export function computeTrust(status: RulesEvaluation, prevScore: number): TrustScore {
  let deduction = 0;
  for (const m of status.metrics) {
    const w = TRUST_WEIGHTS[m.name] ?? 0;
    deduction += w * statusFactor(m.status);
  }
  const raw = Math.max(0, Math.min(100, 100 - deduction));
  const smoothed = EMA_NEW * raw + EMA_PREV * prevScore;
  const score = Math.round(Math.max(0, Math.min(100, smoothed)));
  return {
    score,
    band: band(score),
    trend: trend(prevScore, score),
  };
}
