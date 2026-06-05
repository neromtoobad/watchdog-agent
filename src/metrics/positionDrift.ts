import type { MetricResult, WatchdogEvent, WatchdogRules } from '../index';

const WARNING_RATIO = 0.7;
const RECENT_WINDOW = 10;

export function evaluatePositionDrift(
  events: WatchdogEvent[],
  rules: WatchdogRules,
  portfolioUsdt: number,
  _now: number,
): MetricResult {
  const threshold = rules.maxPositionSizePercent;

  const opens = events
    .filter((e) => e.type === 'trade-open' && typeof e.payload.sizeUsdt === 'number')
    .slice(-RECENT_WINDOW);

  let avgPct = 0;
  if (opens.length > 0 && portfolioUsdt > 0) {
    const sum = opens.reduce((acc, e) => acc + (e.payload.sizeUsdt as number), 0);
    const avgSize = sum / opens.length;
    avgPct = (avgSize / portfolioUsdt) * 100;
  }
  const value = Number(avgPct.toFixed(4));

  let status: MetricResult['status'];
  if (value > threshold) status = 'violation';
  else if (value >= threshold * WARNING_RATIO) status = 'warning';
  else status = 'ok';

  return {
    name: 'positionDrift',
    status,
    value,
    threshold,
    detail:
      status === 'violation'
        ? `avg position ${value.toFixed(2)}% of portfolio exceeds limit of ${threshold}%`
        : status === 'warning'
          ? `avg position ${value.toFixed(2)}% approaching limit ${threshold}%`
          : `avg position ${value.toFixed(2)}% of portfolio (limit ${threshold}%)`,
  };
}
