import type { Forecast, WatchdogRules } from '../index';

export const FORECAST_HORIZON = 8; // trades
export const FORECAST_MIN_SAMPLES = 3;
export const FORECAST_HISTORY_CAP = 30;

interface Projection {
  slope: number;
  intercept: number;
  n: number;
}

function linearProjection(samples: number[]): Projection | null {
  const n = samples.length;
  if (n < FORECAST_MIN_SAMPLES) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += samples[i];
    sumXY += i * samples[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept, n };
}

function thresholdsFor(rules: WatchdogRules): Record<string, number> {
  return {
    frequency: rules.maxTradesPerHour,
    positionDrift: rules.maxPositionSizePercent,
    drawdown: rules.maxDrawdownPercent,
    lossStreak: rules.maxConsecutiveLosses,
    signalOverride: rules.maxSignalOverridesPerHour,
  };
}

export function forecastBreaches(
  history: Record<string, number[]>,
  rules: WatchdogRules,
  horizon: number = FORECAST_HORIZON,
): Forecast[] {
  const thresholds = thresholdsFor(rules);
  const out: Forecast[] = [];

  for (const [name, samples] of Object.entries(history)) {
    const threshold = thresholds[name];
    if (threshold === undefined) continue;
    const current = samples.length > 0 ? samples[samples.length - 1] : 0;
    if (current > threshold) continue; // already in violation — no forecast needed

    const proj = linearProjection(samples);
    if (!proj) continue;
    if (proj.slope <= 0) continue; // improving or flat

    const breachX = (threshold - proj.intercept) / proj.slope;
    const tradesUntilBreach = Math.ceil(breachX - (proj.n - 1));
    if (tradesUntilBreach <= 0) continue;
    if (tradesUntilBreach > horizon) continue;

    const projection = proj.intercept + proj.slope * (proj.n - 1 + tradesUntilBreach);
    out.push({
      metric: name,
      projection: Number(projection.toFixed(4)),
      breachInTrades: tradesUntilBreach,
      detail: `${name} on track to breach ${threshold} in ~${tradesUntilBreach} trade${tradesUntilBreach === 1 ? '' : 's'} (slope ${proj.slope.toFixed(3)}/sample)`,
    });
  }
  return out;
}

export function appendHistory(
  history: Record<string, number[]>,
  name: string,
  value: number,
  cap: number = FORECAST_HISTORY_CAP,
): void {
  const arr = history[name] ?? (history[name] = []);
  arr.push(value);
  if (arr.length > cap) arr.splice(0, arr.length - cap);
}
