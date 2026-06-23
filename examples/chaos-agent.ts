/**
 * chaos-agent.ts — THE demo moment.
 *
 * Starts the dashboard, then runs the OVERTRADER scenario against a Watchdog
 * configured with onViolation:'pause' and AI diagnosis enabled. Narrates each
 * trade as it happens. The instant the agent pauses, prints the LLM-generated
 * incident diagnosis. Then resets and shows recovery.
 *
 * Set WATCHDOG_AI_API_KEY + WATCHDOG_AI_MODEL in the environment to get a real
 * diagnosis. Without them, you get the templated fallback (the demo never breaks).
 *
 *   WATCHDOG_PORT=3000 npx ts-node examples/chaos-agent.ts
 *   open http://localhost:3000
 */
import * as fs from 'fs';
import * as path from 'path';
import { Watchdog, WatchdogConfig, TradeRequest, TradeDecision } from '../src/index';
import { createDashboardServer } from '../src/server/dashboard';
import { overtrader } from '../chaos/scenarios';

// load .env.example into process.env (so the AI key is picked up without a real .env)
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
    maxTradesPerHour: 10,        // overtrader fires 25 → trips on #11
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

function banner(s: string) {
  const bar = '─'.repeat(s.length + 4);
  console.log(`\n${bar}\n  ${s}\n${bar}`);
}

// ── narration wrapper around checkTrade ──────────────────────────────
// counts each trade, prints decision + trust + forecast, paces the
// scenario so the dashboard can visibly update between trades.
function narrate(w: Watchdog, paceMs: number) {
  let n = 0;
  const orig = w.checkTrade.bind(w);
  (w as any).checkTrade = async (t: TradeRequest): Promise<TradeDecision> => {
    n++;
    const idx = n;
    const decision = await orig(t);
    const trust = decision.trustScore;
    const forecastsTxt = decision.forecasts.length > 0
      ? decision.forecasts.map(f => `${f.metric} breach in ~${f.breachInTrades}`).join(', ')
      : '';
    if (!decision.approved) {
      console.log(
        `  trade ${String(idx).padStart(2)} → \x1b[31mBLOCKED\x1b[0m   trust=${String(trust).padStart(3)}` +
        (decision.reason ? `   reason: ${decision.reason}` : '') +
        (decision.action === 'pause' ? `   \x1b[31m(agent paused)\x1b[0m` : ''),
      );
    } else {
      const flag = forecastsTxt ? `   \x1b[33m⚠ forecast: ${forecastsTxt}\x1b[0m` : '';
      console.log(`  trade ${String(idx).padStart(2)} → approved   trust=${String(trust).padStart(3)}${flag}`);
    }
    if (paceMs > 0) await wait(paceMs);
    return decision;
  };
}

(async () => {
  banner('WATCHDOG chaos-agent — THE demo moment');

  const w = new Watchdog(cfg);
  const port = Number(process.env.PORT || process.env.WATCHDOG_PORT) || 3000;
  await createDashboardServer(w, port);

  console.log(`\nopen the dashboard:  http://localhost:${port}`);
  console.log(`fleet leaderboard:   http://localhost:${port}/leaderboard.html`);
  console.log(`live trust badge:    http://localhost:${port}/badge/${cfg.agentId}`);
  console.log(`\nai key configured:   ${process.env.WATCHDOG_AI_API_KEY ? 'YES (real diagnosis)' : 'NO (templated fallback)'}`);
  console.log(`ai model:            ${process.env.WATCHDOG_AI_MODEL ?? '(unset)'}\n`);

  console.log('giving you 3 s to load the dashboard…');
  await wait(3_000);

  // ── act 1: run overtrader with live narration ──────────────────────
  banner('ACT 1 — running OVERTRADER (25 rapid trades, limit 10/hour)');
  narrate(w, 350);
  await overtrader.run(w);

  // ── act 2: pause hit → diagnosis ───────────────────────────────────
  banner('ACT 2 — agent paused → LLM diagnosis');
  console.log('waiting for AI diagnosis to land (real call to anthropic.com)…');
  const diag = await w.flushDiagnosis();
  if (!diag) {
    console.log('  (no diagnosis produced)');
  } else {
    console.log(`\n  \x1b[36msource:\x1b[0m       ${diag.source}`);
    console.log(`  \x1b[36mtimestamp:\x1b[0m    ${new Date(diag.timestamp).toISOString()}`);
    console.log(`\n  \x1b[1msummary:\x1b[0m\n    ${diag.summary}`);
    console.log(`\n  \x1b[1mlikely cause:\x1b[0m\n    ${diag.likelyCause}`);
    console.log(`\n  \x1b[1mrecommendation:\x1b[0m\n    ${diag.recommendation}`);
    const mc: any = (diag.context as any).marketContext;
    if (mc?.ok) {
      console.log(`\n  \x1b[36mmarket context:\x1b[0m  ${mc.symbol}  lastPrice=${mc.lastPrice}  fundingRate=${mc.fundingRate}  vol24h=${mc.recentVolatility}%`);
    }
  }

  // ── act 3: audit chain proof ───────────────────────────────────────
  banner('ACT 3 — audit chain (tamper-evident decision log)');
  const trail = w.getAuditTrail();
  const ver = w.verifyAuditChain();
  console.log(`  ${trail.length} entries  ·  verified=${ver.valid}  ·  brokenAt=${ver.brokenAt}`);
  console.log(`  first hash:  ${trail[0]?.hash.slice(0, 24)}…`);
  console.log(`  last hash:   ${trail[trail.length - 1]?.hash.slice(0, 24)}…`);

  // ── act 4: recovery via reset ──────────────────────────────────────
  banner('ACT 4 — reset → recovery');
  await wait(2_000);
  w.reset();
  console.log(`  after reset: trust=${w.getTrustScore().score}/${w.getTrustScore().band}, paused=${w.getStatus().paused}`);
  console.log('  now running 4 well-behaved trades…');
  for (let i = 0; i < 4; i++) {
    const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    console.log(`    recovery trade ${i + 1} → approved=${d.approved}  trust=${d.trustScore}`);
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 15 });
    await wait(500);
  }
  const t = w.getTrustScore();
  console.log(`\n  final trust: ${t.score} (${t.band}, ${t.trend})`);

  banner('done — dashboard still live. Ctrl+C to stop.');
})();
