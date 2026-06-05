import { Watchdog, WatchdogConfig } from '../src/index';

const cfg: WatchdogConfig = {
  agentId: 'forecast-smoke',
  portfolioUsdt: 10_000,
  rules: {
    maxTradesPerHour: 50,            // generous so frequency doesn't fire
    maxPositionSizePercent: 100,
    maxDrawdownPercent: 10,
    maxConsecutiveLosses: 100,
    maxSignalOverridesPerHour: 100,
  },
  onViolation: 'log',
};

console.warn = () => {};

async function main() {
  let passed = 0, failed = 0;
  const assert = (n: string, c: boolean, d?: string) => {
    if (c) { passed++; console.log(`  ok  ${n}`); }
    else   { failed++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); }
  };

  console.log('[1] steadily worsening drawdown → forecast fires before actual violation');
  {
    const w = new Watchdog(cfg);
    // open one trade so an "open" event exists for context (not strictly needed)
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });

    // each close loses 250 USDT → 2.5% incremental drawdown
    // peak=10000; after k losses: dd_pct = (10000 - (10000 - 250k)) / 10000 * 100 = 2.5k
    // breach at k > 4 (since threshold=10%; >10 → violation)
    const trail: { step: number; dd?: number; forecast?: { breachInTrades: number | null; projection: number; detail: string }; status: string }[] = [];

    let firstForecastAt = -1;
    let actualViolationAt = -1;

    for (let k = 1; k <= 8; k++) {
      w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -250 });
      const status = w.getStatus();
      const fc = w.getForecast();
      const dd = status.metrics.drawdown;
      const ddForecast = fc.find(f => f.metric === 'drawdown');
      trail.push({
        step: k,
        dd: dd.value,
        forecast: ddForecast ? { breachInTrades: ddForecast.breachInTrades, projection: ddForecast.projection, detail: ddForecast.detail } : undefined,
        status: dd.status,
      });
      if (ddForecast && firstForecastAt < 0) firstForecastAt = k;
      if (dd.status === 'violation' && actualViolationAt < 0) actualViolationAt = k;
    }

    for (const row of trail) console.log(`   step=${row.step} dd=${row.dd}% status=${row.status} forecast=${JSON.stringify(row.forecast) ?? '—'}`);
    console.log(`   firstForecastAt=${firstForecastAt} actualViolationAt=${actualViolationAt}`);

    assert('drawdown forecast appeared at some step', firstForecastAt >= 0);
    assert('drawdown eventually violated', actualViolationAt >= 0);
    assert('forecast appeared BEFORE the actual violation', firstForecastAt < actualViolationAt, `forecast@${firstForecastAt} viol@${actualViolationAt}`);
    const forecastedRow = trail.find(r => r.step === firstForecastAt)!;
    assert('forecast breachInTrades is a positive integer ≤ horizon', typeof forecastedRow.forecast!.breachInTrades === 'number' && (forecastedRow.forecast!.breachInTrades ?? 0) > 0 && (forecastedRow.forecast!.breachInTrades ?? 0) <= 8);
    assert('forecast detail mentions drawdown + threshold', /drawdown.*10/.test(forecastedRow.forecast!.detail));
  }

  console.log('\n[2] healthy/flat sequence produces no forecasts');
  {
    const w = new Watchdog(cfg);
    for (let i = 0; i < 5; i++) {
      await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
      w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 10 });
    }
    const fc = w.getForecast();
    console.log(`   forecasts: ${JSON.stringify(fc)}`);
    assert('no forecasts on flat/improving metrics', fc.length === 0);
  }

  console.log('\n[3] checkTrade decisions carry the current forecasts');
  {
    const w = new Watchdog(cfg);
    // prime worsening drawdown
    for (let k = 1; k <= 3; k++) w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -250 });
    const decision = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    console.log(`   decision.forecasts: ${JSON.stringify(decision.forecasts)}`);
    assert('forecasts on TradeDecision', Array.isArray(decision.forecasts));
    assert('at least one forecast on the decision', decision.forecasts.length >= 1);
    assert('forecasted metric is drawdown', decision.forecasts.some(f => f.metric === 'drawdown'));
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
