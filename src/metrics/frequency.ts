import type { MetricResult, WatchdogEvent, WatchdogRules } from '../index';

const HOUR_MS = 60 * 60 * 1000;
const WARNING_RATIO = 0.7;

export function evaluateFrequency(
  events: WatchdogEvent[],
  rules: WatchdogRules,
  now: number,
): MetricResult {
  const threshold = rules.maxTradesPerHour;
  const cutoff = now - HOUR_MS;
  const value = events.filter((e) => e.type === 'trade-open' && e.timestamp >= cutoff).length;

  let status: MetricResult['status'];
  if (value > threshold) status = 'violation';
  else if (value >= threshold * WARNING_RATIO) status = 'warning';
  else status = 'ok';

  return {
    name: 'frequency',
    status,
    value,
    threshold,
    detail:
      status === 'violation'
        ? `${value} trades in last hour exceeds limit of ${threshold}`
        : status === 'warning'
          ? `${value}/${threshold} trades in last hour — approaching limit`
          : `${value}/${threshold} trades in last hour`,
  };
}
