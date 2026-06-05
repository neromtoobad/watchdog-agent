import type { MetricResult, WatchdogEvent, WatchdogRules } from '../index';

export function evaluateLossStreak(
  events: WatchdogEvent[],
  rules: WatchdogRules,
  _now: number,
): MetricResult {
  const threshold = rules.maxConsecutiveLosses;

  let streak = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== 'trade-close') continue;
    const pnl = e.payload.pnlUsdt as number | undefined;
    if (typeof pnl !== 'number') continue;
    if (pnl < 0) streak++;
    else break;
  }

  let status: MetricResult['status'];
  if (streak >= threshold) status = 'violation';
  else if (streak === threshold - 1) status = 'warning';
  else status = 'ok';

  return {
    name: 'lossStreak',
    status,
    value: streak,
    threshold,
    detail:
      status === 'violation'
        ? `${streak} consecutive losses meets/exceeds limit of ${threshold}`
        : status === 'warning'
          ? `${streak} consecutive losses — one more triggers violation`
          : `${streak} consecutive losses (limit ${threshold})`,
  };
}
