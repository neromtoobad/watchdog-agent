/**
 * chaos-frozen.ts — like examples/chaos-agent.ts but stops AFTER the pause +
 * AI diagnosis land, so the dashboard sits on the dramatic frame indefinitely.
 */
import * as fs from 'fs';
import * as path from 'path';
import { Watchdog, WatchdogConfig, TradeRequest, TradeDecision } from '../src/index';
import { createDashboardServer } from '../src/server/dashboard';
import { overtrader } from '../chaos/scenarios';
import { clear } from '../src/intelligence/fleet';

const envPath = path.join(__dirname, '..', '.env.example');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const cfg: WatchdogConfig = {
  agentId: 'chaos-agent',
  portfolioUsdt: 10_000,
  rules: {
    maxTradesPerHour: 10,
    maxPositionSizePercent: 25,
    maxDrawdownPercent: 15,
    maxConsecutiveLosses: 4,
    maxSignalOverridesPerHour: 3,
  },
  onViolation: 'pause',
  ai: { enabled: true },
  fleet: { register: true },
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

(async () => {
  clear();
  const w = new Watchdog(cfg);
  const port = Number(process.env.WATCHDOG_PORT) || 3000;
  await createDashboardServer(w, port);

  console.log(`\ndashboard up at http://localhost:${port}`);

  // pace each checkTrade so the gauge moves visibly
  const orig = w.checkTrade.bind(w);
  (w as any).checkTrade = async (t: TradeRequest): Promise<TradeDecision> => {
    const d = await orig(t);
    await wait(150);
    return d;
  };

  await wait(2_000);
  console.log('\nrunning overtrader…');
  await overtrader.run(w);
  console.log('\nflushing AI diagnosis…');
  await w.flushDiagnosis();
  console.log('\nFROZEN — paused with diagnosis on display. server stays alive.');
})();
