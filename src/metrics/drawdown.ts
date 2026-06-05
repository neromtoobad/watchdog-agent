import type { MetricResult, WatchdogEvent, WatchdogRules } from '../index';

const WARNING_RATIO = 0.7;

export function evaluateDrawdown(
  events: WatchdogEvent[],
  rules: WatchdogRules,
  portfolioUsdt: number,
  _now: number,
): MetricResult {
  const threshold = rules.maxDrawdownPercent;

  let equity = portfolioUsdt;
  let peak = portfolioUsdt;

  for (const e of events) {
    if (e.type !== 'trade-close') continue;
    const pnl = e.payload.pnlUsdt;
    if (typeof pnl !== 'number') continue;
    equity += pnl;
    if (equity > peak) peak = equity;
  }

  const drawdownPct = peak > 0 ? Math.max(0, ((peak - equity) / peak) * 100) : 0;
  const value = Number(drawdownPct.toFixed(4));

  let status: MetricResult['status'];
  if (value > threshold) status = 'violation';
  else if (value >= threshold * WARNING_RATIO) status = 'warning';
  else status = 'ok';

  return {
    name: 'drawdown',
    status,
    value,
    threshold,
    detail:
      status === 'violation'
        ? `drawdown ${value.toFixed(2)}% exceeds limit of ${threshold}%`
        : status === 'warning'
          ? `drawdown ${value.toFixed(2)}% approaching limit ${threshold}%`
          : `drawdown ${value.toFixed(2)}% (limit ${threshold}%)`,
  };
}
