import type { MetricResult, WatchdogEvent, WatchdogRules } from '../index';

const HOUR_MS = 60 * 60 * 1000;
const WARNING_RATIO = 0.7;

function isConflict(signal: string, action: string): boolean {
  const a = action.toLowerCase();
  if (signal === 'bearish' && a.includes('long')) return true;
  if (signal === 'bullish' && a.includes('short')) return true;
  return false;
}

export function evaluateSignalOverride(
  events: WatchdogEvent[],
  rules: WatchdogRules,
  now: number,
): MetricResult {
  const threshold = rules.maxSignalOverridesPerHour;
  const cutoff = now - HOUR_MS;

  let value = 0;
  for (const e of events) {
    if (e.type !== 'signal') continue;
    if (e.timestamp < cutoff) continue;
    const signal = e.payload.signal;
    const action = e.payload.action;
    if (typeof signal !== 'string' || typeof action !== 'string') continue;
    if (isConflict(signal, action)) value++;
  }

  let status: MetricResult['status'];
  if (value > threshold) status = 'violation';
  else if (value >= threshold * WARNING_RATIO) status = 'warning';
  else status = 'ok';

  return {
    name: 'signalOverride',
    status,
    value,
    threshold,
    detail:
      status === 'violation'
        ? `${value} signal overrides in last hour exceeds limit of ${threshold}`
        : status === 'warning'
          ? `${value}/${threshold} signal overrides in last hour — approaching limit`
          : `${value}/${threshold} signal overrides in last hour`,
  };
}
