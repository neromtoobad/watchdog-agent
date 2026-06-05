import type { MetricResult, MetricStatus, WatchdogEvent, WatchdogRules } from '../index';
import { evaluateFrequency } from '../metrics/frequency';
import { evaluatePositionDrift } from '../metrics/positionDrift';
import { evaluateDrawdown } from '../metrics/drawdown';
import { evaluateLossStreak } from '../metrics/lossStreak';
import { evaluateSignalOverride } from '../metrics/signalOverride';

export interface RulesEvaluation {
  timestamp: number;
  overall: MetricStatus;
  metrics: MetricResult[];
  violations: string[];
}

const SEVERITY: Record<MetricStatus, number> = { ok: 0, warning: 1, violation: 2 };

function worst(a: MetricStatus, b: MetricStatus): MetricStatus {
  return SEVERITY[b] > SEVERITY[a] ? b : a;
}

export function evaluateAll(
  events: WatchdogEvent[],
  rules: WatchdogRules,
  portfolioUsdt: number,
  now: number,
): RulesEvaluation {
  const metrics: MetricResult[] = [
    evaluateFrequency(events, rules, now),
    evaluatePositionDrift(events, rules, portfolioUsdt, now),
    evaluateDrawdown(events, rules, portfolioUsdt, now),
    evaluateLossStreak(events, rules, now),
    evaluateSignalOverride(events, rules, now),
  ];

  let overall: MetricStatus = 'ok';
  const violations: string[] = [];
  for (const m of metrics) {
    overall = worst(overall, m.status);
    if (m.status === 'violation') violations.push(`${m.name}: ${m.detail}`);
  }

  return { timestamp: now, overall, metrics, violations };
}

