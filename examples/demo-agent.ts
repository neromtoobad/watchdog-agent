/**
 * demo-agent.ts — a well-behaved Watchdog example.
 *
 * Spins up the dashboard, registers in the fleet, runs the CONTROL scenario
 * (the false-positive baseline) and keeps the agent alive so you can watch
 * the trust gauge sit pinned at 100 / healthy.
 *
 *   WATCHDOG_PORT=3000 npx ts-node examples/demo-agent.ts
 *   open http://localhost:3000
 */
import { Watchdog, WatchdogConfig } from '../src/index';
import { createDashboardServer } from '../src/server/dashboard';
import { CONTROL } from '../chaos/scenarios';
import { loadDotenv } from '../src/util/env';
loadDotenv();

const cfg: WatchdogConfig = {
  agentId: 'demo-agent',
  portfolioUsdt: 10_000,
  rules: {
    maxTradesPerHour: 10,
    maxPositionSizePercent: 25,
    maxDrawdownPercent: 15,
    maxConsecutiveLosses: 4,
    maxSignalOverridesPerHour: 3,
  },
  onViolation: 'log',
  ai: { enabled: false },
  fleet: { register: true },
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function banner(s: string) {
  const bar = '─'.repeat(s.length + 4);
  console.log(`\n${bar}\n  ${s}\n${bar}`);
}

(async () => {
  banner('WATCHDOG demo-agent — well-behaved baseline');

  const w = new Watchdog(cfg);
  const port = Number(process.env.PORT || process.env.WATCHDOG_PORT) || 3000;
  await createDashboardServer(w, port);

  console.log(`\nopen the dashboard:  http://localhost:${port}`);
  console.log(`fleet leaderboard:   http://localhost:${port}/leaderboard.html`);
  console.log(`live trust badge:    http://localhost:${port}/badge/${cfg.agentId}\n`);

  // give a viewer a moment to open the dashboard
  await wait(2_000);

  console.log('[1] running CONTROL scenario (the well-behaved baseline)…');
  await CONTROL.run(w);
  let t = w.getTrustScore();
  console.log(`    → trust ${t.score} (${t.band}, ${t.trend}) — should be exactly 100/healthy/flat`);

  // keep generating small, well-behaved activity forever so the dashboard stays lively
  console.log('\n[2] keeping the agent alive — small aligned trades every 4s. trust stays green.');
  console.log('    press Ctrl+C to stop.\n');
  let n = 0;
  setInterval(async () => {
    n++;
    const direction: 'long' | 'short' = n % 2 === 0 ? 'long' : 'short';
    w.reportSignal({ signal: direction === 'long' ? 'bullish' : 'bearish', action: `open-${direction}` });
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: Math.round((Math.random() - 0.4) * 30) });
    t = w.getTrustScore();
    process.stdout.write(`    tick ${String(n).padStart(3)}  trust=${t.score} (${t.band})\r`);
  }, 4_000);
})();
