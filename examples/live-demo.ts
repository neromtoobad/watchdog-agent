/**
 * live-demo.ts — a REAL paper-trading fleet on LIVE Bitget price, monitored
 * live by the actual WATCHDOG engine, shown on the dashboard.
 *
 * Three agents trade the real BTCUSDT price in real time:
 *   · aria-disciplined — conservative momentum, rate-limited → stays healthy
 *   · atlas-overtrader — fires on every tick → trips frequency, auto-paused
 *   · nova-revenge     — doubles size after losses → trips position-drift / loss-streak
 *
 * Nothing here is scripted. Prices are real, PnL is real (paper), and every
 * trust score / violation / incident is computed by the real WATCHDOG engine.
 *
 *   npm run demo:live        (opens the dashboard automatically)
 *
 * Price source, in order of preference (so it runs anywhere, VPN or not):
 *   1. our deployed read-only endpoint  https://watchdog-bitget.vercel.app/api/market
 *   2. local bgc / Bitget public REST   (getMarketContext)
 *   3. a clearly-labelled simulated walk (only if there is no network at all)
 */
import { execFile } from 'child_process';
import { Watchdog, WatchdogConfig, WatchdogRules } from '../src/index';
import { createDashboardServer } from '../src/server/dashboard';
import { getMarketContext } from '../src/market/context';
import { clear } from '../src/intelligence/fleet';
import { loadDotenv } from '../src/util/env';
loadDotenv(); // a WATCHDOG_AI_API_KEY in .env lights up the real AI incident report

const SYMBOL = 'BTCUSDT';
const TICK_MS = 3500;
const REMOTE_MARKET = 'https://watchdog-bitget.vercel.app/api/market';
const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[38;5;42m', amber: '\x1b[38;5;221m', red: '\x1b[38;5;203m', teal: '\x1b[38;5;43m' };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── live price (real Bitget, read-only) ───────────────────────────────
let simPrice = 64000; // only used if there is no network at all
async function fetchPrice(): Promise<{ price: number; src: string } | null> {
  // 1. our own deployed read-only market endpoint — reachable from anywhere
  try {
    const r = await fetch(REMOTE_MARKET, { signal: AbortSignal.timeout(6000) });
    const j: any = await r.json();
    if (j && j.ok && j.lastPrice) return { price: Number(j.lastPrice), src: 'Bitget · via watchdog /api/market' };
  } catch { /* try next */ }
  // 2. local bgc / Bitget public REST
  try {
    const c = await getMarketContext(SYMBOL);
    if (c.ok && c.lastPrice) return { price: c.lastPrice, src: `Bitget · ${c.source}` };
  } catch { /* try next */ }
  return null;
}

// ── agents ────────────────────────────────────────────────────────────
interface Agent {
  w: Watchdog;
  id: string;
  kind: 'disciplined' | 'overtrader' | 'revenge';
  entry: number | null;
  size: number;
  cool: number;
}
function mk(id: string, kind: Agent['kind'], rules: WatchdogRules): Agent {
  const cfg: WatchdogConfig = {
    agentId: id,
    portfolioUsdt: 10_000,
    rules,
    onViolation: 'pause',
    ai: { enabled: true }, // templated fallback with no key; real AI with a key in .env
    fleet: { register: true },
  };
  return { w: new Watchdog(cfg), id, kind, entry: null, size: kind === 'disciplined' ? 1000 : 800, cool: 0 };
}

// each agent carries its own risk policy — that is the point: WATCHDOG rules are per-agent
const DISC_RULES: WatchdogRules = { maxTradesPerHour: 80, maxPositionSizePercent: 25, maxDrawdownPercent: 15, maxConsecutiveLosses: 5, maxSignalOverridesPerHour: 6 };
const OVER_RULES: WatchdogRules = { maxTradesPerHour: 10, maxPositionSizePercent: 25, maxDrawdownPercent: 15, maxConsecutiveLosses: 4, maxSignalOverridesPerHour: 3 };
const REV_RULES: WatchdogRules  = { maxTradesPerHour: 60, maxPositionSizePercent: 25, maxDrawdownPercent: 12, maxConsecutiveLosses: 4, maxSignalOverridesPerHour: 3 };

async function step(a: Agent, price: number, roc: number): Promise<void> {
  const pnl = (size: number) => Math.round(((price - (a.entry as number)) / (a.entry as number)) * size);

  if (a.kind === 'disciplined') {
    if (a.entry != null && roc < -0.0003) {
      await a.w.checkTrade({ type: 'close', symbol: SYMBOL, sizeUsdt: a.size, direction: 'long' });
      a.w.reportTradeClosed({ symbol: SYMBOL, pnlUsdt: pnl(a.size) });
      a.entry = null; a.cool = 2;
    } else if (a.entry == null && roc > 0.0004 && a.cool <= 0) {
      a.size = 1000;
      const d = await a.w.checkTrade({ type: 'open', symbol: SYMBOL, sizeUsdt: a.size, direction: 'long' });
      if (d.approved) a.entry = price;
    }
    if (a.cool > 0) a.cool--;
  } else if (a.kind === 'overtrader') {
    if (a.entry != null) {
      await a.w.checkTrade({ type: 'close', symbol: SYMBOL, sizeUsdt: a.size, direction: 'long' });
      a.w.reportTradeClosed({ symbol: SYMBOL, pnlUsdt: pnl(a.size) });
      a.entry = null;
    }
    a.size = 800;
    const d = await a.w.checkTrade({ type: 'open', symbol: SYMBOL, sizeUsdt: a.size, direction: 'long' });
    if (d.approved) a.entry = price; // once WATCHDOG pauses it, opens are blocked — exactly the point
  } else { // revenge
    if (a.entry != null) {
      const p = pnl(a.size);
      await a.w.checkTrade({ type: 'close', symbol: SYMBOL, sizeUsdt: a.size, direction: 'long' });
      a.w.reportTradeClosed({ symbol: SYMBOL, pnlUsdt: p });
      a.size = p < 0 ? Math.min(a.size * 2, 5000) : 800; // double down after a loss
      a.entry = null;
    }
    if (a.cool <= 0) {
      const d = await a.w.checkTrade({ type: 'open', symbol: SYMBOL, sizeUsdt: a.size, direction: 'long' });
      if (d.approved) a.entry = price;
      a.cool = 1;
    } else a.cool--;
  }
}

function bandColor(band: string) { return band === 'healthy' ? C.green : band === 'caution' ? C.amber : C.red; }

(async () => {
  clear();
  const rawPort = Number(process.env.PORT || process.env.WATCHDOG_PORT) || 3000;

  const agents: Agent[] = [
    mk('aria-disciplined', 'disciplined', DISC_RULES),
    mk('atlas-overtrader', 'overtrader', OVER_RULES),
    mk('nova-revenge', 'revenge', REV_RULES),
  ];

  // the dashboard monitor view points at the overtrader (the agent that will be caught)
  const primary = agents[1].w;
  let server;
  try {
    server = await createDashboardServer(primary, rawPort);
  } catch {
    server = await createDashboardServer(primary, 0); // port busy → auto-pick a free one
  }
  const url = server.url;

  console.log(`${C.teal}${C.bold}\n  WATCHDOG × Bitget — live paper-trading fleet${C.reset}`);
  console.log(`${C.dim}  real BTCUSDT price · real WATCHDOG monitoring · paper PnL (no real orders)${C.reset}`);
  console.log(`\n  dashboard:   ${C.bold}${url}/app${C.reset}`);
  console.log(`  leaderboard: ${url}/leaderboard.html\n`);

  // try to open the browser (macOS)
  try { execFile('open', [`${url}/app`], () => {}); } catch { /* non-mac: ignore */ }

  // warm up a few prices for the rate-of-change signal
  const prices: number[] = [];
  let lastSrc = '';
  for (let i = 0; i < 3; i++) {
    const p = await fetchPrice();
    if (p) { prices.push(p.price); lastSrc = p.src; simPrice = p.price; }
    await wait(700);
  }
  if (!prices.length) {
    console.log(`${C.amber}  no live network — running a simulated price walk (labelled).${C.reset}`);
    prices.push(simPrice);
    lastSrc = 'SIMULATED (no network)';
  }
  console.log(`  price source: ${C.bold}${lastSrc}${C.reset}\n`);
  console.log(`  ${C.dim}Ctrl+C to stop. Open the dashboard to watch trust scores update live.${C.reset}\n`);

  let n = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await wait(TICK_MS);
    n++;
    const live = await fetchPrice();
    let price: number;
    if (live) { price = live.price; lastSrc = live.src; }
    else { simPrice *= 1 + (Math.sin(n / 3) * 0.0008 + (n % 5 === 0 ? -0.0015 : 0.0006)); price = Math.round(simPrice); } // labelled sim fallback
    prices.push(price); if (prices.length > 20) prices.shift();
    const roc = prices.length >= 4 ? (price - prices[prices.length - 4]) / prices[prices.length - 4] : 0;

    for (const a of agents) await step(a, price, roc);
    for (const a of agents) await a.w.flushDiagnosis();

    const line = agents.map((a) => {
      const t = a.w.getTrustScore();
      const paused = a.w.getStatus().paused ? ' PAUSED' : '';
      return `${bandColor(t.band)}${a.id.split('-')[0]} ${t.score}${paused}${C.reset}`;
    }).join('  ·  ');
    console.log(`  t${String(n).padStart(2)}  BTC $${Math.round(price).toLocaleString()}   ${line}`);
  }
})();
