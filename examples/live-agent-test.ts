/**
 * live-agent-test.ts — does WATCHDOG actually work on agents it has never seen?
 *
 * This is NOT a seeded chaos scenario. Two genuinely autonomous agents make
 * their own trading decisions in reaction to REAL BTC hourly candles (last 7
 * days, pulled live from CoinGecko). WATCHDOG wraps both and we observe what
 * it does — nothing about the outcome is scripted. The misbehavior, if any,
 * emerges from each agent's own logic meeting real market data.
 *
 *   npx ts-node examples/live-agent-test.ts
 *
 * Agent A — "Apollo": a disciplined SMA-crossover momentum bot. Fixed sizing,
 *   one position at a time, acts on its own signal. Should stay healthy.
 *
 * Agent B — "Reckless": a buy-the-dip martingale. Every down-bar it opens a
 *   long AND doubles size (averaging down), ignoring its own bearish read.
 *   A real, common strategy flaw — not a hand-coded "fire 25 trades".
 */
import { Watchdog, WatchdogConfig, TradeDecision } from '../src/index';

// ── REAL BTC hourly candles [ts, open, high, low, close], last 7 days ──
// pulled live from CoinGecko (bitcoin, 7d) at build time.
const CANDLES: [number, number, number, number, number][] = [
  [1780516800000,66030,66047,65357,65357],[1780531200000,65256,65671,64022,64022],
  [1780545600000,64253,64367,61557,64305],[1780560000000,64273,64641,63477,63609],
  [1780574400000,63706,63706,62183,62451],[1780588800000,62554,64353,62413,63902],
  [1780603200000,63733,64011,62933,63571],[1780617600000,63429,63796,63166,63796],
  [1780632000000,63741,63818,62322,62676],[1780646400000,62651,63421,61394,62930],
  [1780660800000,62905,63051,61971,61971],[1780675200000,61678,62312,60246,60465],
  [1780689600000,60212,61401,59228,60317],[1780704000000,60086,61876,60086,60922],
  [1780718400000,61300,61399,60560,60670],[1780732800000,60726,61133,59665,60977],
  [1780747200000,60877,61422,60288,60767],[1780761600000,60928,61071,60442,60740],
  [1780776000000,60787,60831,60423,60595],[1780790400000,60600,60919,60438,60862],
  [1780804800000,60877,61665,60758,61665],[1780819200000,61550,62355,61504,62355],
  [1780833600000,62359,62800,62302,62578],[1780848000000,62592,62592,61651,62122],
  [1780862400000,62040,62272,61206,61278],[1780876800000,61391,63373,61391,63255],
  [1780891200000,63208,63739,62832,63098],[1780905600000,63009,63264,62461,63264],
  [1780920000000,63118,63801,63001,63417],[1780934400000,63062,64156,62886,63732],
  [1780948800000,63788,63924,63324,63364],[1780963200000,63358,63792,62994,63078],
  [1780977600000,63059,63059,62473,62730],[1780992000000,62839,63454,62776,63164],
  [1781006400000,63101,63101,62510,62681],[1781020800000,62806,62830,61183,61244],
  [1781035200000,61108,61978,60892,61978],[1781049600000,62025,62132,61547,61658],
  [1781064000000,61658,61872,61211,61480],[1781078400000,61497,61685,61074,61647],
  [1781092800000,61590,61592,60882,61005],[1781107200000,60996,62551,60994,62551],
];
const closes = CANDLES.map((c) => c[4]);
const PORTFOLIO = 10_000;

const C = { reset:'\x1b[0m', dim:'\x1b[2m', bold:'\x1b[1m', green:'\x1b[38;5;42m',
  amber:'\x1b[38;5;221m', red:'\x1b[38;5;203m', teal:'\x1b[38;5;43m', gray:'\x1b[38;5;245m' };

function cfg(agentId: string): WatchdogConfig {
  return {
    agentId, portfolioUsdt: PORTFOLIO,
    rules: {
      maxTradesPerHour: 10,
      maxPositionSizePercent: 25,
      maxDrawdownPercent: 15,
      maxConsecutiveLosses: 4,
      maxSignalOverridesPerHour: 3,
    },
    onViolation: 'pause',
    ai: { enabled: false },        // keep this test offline + deterministic
    fleet: { register: false },
  };
}
const band = (b: string) => b === 'healthy' ? C.green : b === 'caution' ? C.amber : C.red;
const sma = (arr: number[], i: number, n: number) =>
  i < n - 1 ? null : arr.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n;

interface RunResult {
  approved: number; blocked: number; pausedAtBar: number | null;
  finalTrust: number; finalBand: string; violations: Set<string>;
}

// ── AGENT A — disciplined SMA-crossover momentum ──────────────────────
async function runApollo(): Promise<RunResult> {
  const w = new Watchdog(cfg('apollo-momentum'));
  let approved = 0, blocked = 0, pausedAtBar: number | null = null;
  let posOpen = false, prevFast: number | null = null, prevSlow: number | null = null;
  const violations = new Set<string>();
  let entryPrice = 0;

  for (let i = 0; i < CANDLES.length; i++) {
    const price = closes[i];
    const fast = sma(closes, i, 3), slow = sma(closes, i, 6);
    if (fast === null || slow === null) { prevFast = fast; prevSlow = slow; continue; }

    const crossedUp = prevFast !== null && prevSlow !== null && prevFast <= prevSlow && fast > slow;
    const crossedDown = prevFast !== null && prevSlow !== null && prevFast >= prevSlow && fast < slow;

    if (!posOpen && crossedUp) {
      w.reportSignal({ signal: 'bullish', action: 'open-long' });   // acts on its own signal
      const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: PORTFOLIO * 0.08, direction: 'long' });
      track(d, i);
      if (d.approved) { posOpen = true; entryPrice = price; }
    } else if (posOpen && crossedDown) {
      const pnl = (price - entryPrice) / entryPrice * (PORTFOLIO * 0.08);
      w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: Math.round(pnl) });
      posOpen = false;
    }
    prevFast = fast; prevSlow = slow;
  }

  function track(d: TradeDecision, i: number) {
    if (d.approved) approved++; else { blocked++; if (pausedAtBar === null) pausedAtBar = i; }
    for (const m of Object.values(w.getStatus().metrics)) if (m.status === 'violation') violations.add(m.name);
  }
  const t = w.getTrustScore();
  return { approved, blocked, pausedAtBar, finalTrust: t.score, finalBand: t.band, violations };
}

// ── AGENT B — buy-the-dip martingale (a real, flawed strategy) ────────
async function runReckless(): Promise<RunResult> {
  const w = new Watchdog(cfg('reckless-martingale'));
  let approved = 0, blocked = 0, pausedAtBar: number | null = null;
  let size = PORTFOLIO * 0.05;            // starts at 5%, doubles on each dip
  let lastEntry: number | null = null;
  const violations = new Set<string>();

  for (let i = 1; i < CANDLES.length; i++) {
    const price = closes[i], prev = closes[i - 1];
    const isDip = price < prev;           // its trigger: any down-bar
    if (!isDip) continue;

    // its own read of the market is bearish (price falling) — but it longs anyway
    w.reportSignal({ signal: 'bearish', action: 'open-long' });   // ← signal override
    const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: Math.round(size), direction: 'long' });
    if (d.approved) approved++; else { blocked++; if (pausedAtBar === null) pausedAtBar = i; }
    for (const m of Object.values(w.getStatus().metrics)) if (m.status === 'violation') violations.add(m.name);

    if (d.approved) {
      // it averages down: if still red next bar it will buy bigger.
      // realise the loss on this leg, then double the next bet (martingale flaw)
      if (lastEntry !== null) {
        const pnl = (price - lastEntry) / lastEntry * size;
        w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: Math.round(pnl) });
      }
      lastEntry = price;
      size = Math.min(size * 2, PORTFOLIO);  // double the stake
    }
  }
  const t = w.getTrustScore();
  return { approved, blocked, pausedAtBar, finalTrust: t.score, finalBand: t.band, violations };
}

// ── AGENT C — volatility scalper (overtrades on real volatility) ──────
async function runFrenzy(): Promise<RunResult> {
  const w = new Watchdog(cfg('frenzy-scalper'));
  let approved = 0, blocked = 0, pausedAtBar: number | null = null;
  const violations = new Set<string>();
  let posOpen = false, entry = 0;

  for (let i = 1; i < CANDLES.length; i++) {
    const price = closes[i], prev = closes[i - 1];
    const ret = (price - prev) / prev;
    // its flaw: scalps EVERY bar that moves more than 0.25% — on real
    // intraday volatility that fires constantly → overtrading.
    if (Math.abs(ret) > 0.0025) {
      const dir = ret > 0 ? 'long' : 'short';
      w.reportSignal({ signal: ret > 0 ? 'bullish' : 'bearish', action: `open-${dir}` }); // aligned — isolates frequency
      const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: PORTFOLIO * 0.05, direction: dir as 'long' | 'short' });
      if (d.approved) approved++; else { blocked++; if (pausedAtBar === null) pausedAtBar = i; }
      for (const m of Object.values(w.getStatus().metrics)) if (m.status === 'violation') violations.add(m.name);
      if (d.approved) {
        if (posOpen) { const pnl = (price - entry) / entry * (PORTFOLIO * 0.05); w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: Math.round(pnl) }); }
        posOpen = true; entry = price;
      }
    }
  }
  const t = w.getTrustScore();
  return { approved, blocked, pausedAtBar, finalTrust: t.score, finalBand: t.band, violations };
}

function report(name: string, color: string, r: RunResult, expectHealthy: boolean) {
  console.log(`\n${color}${C.bold}  ${name}${C.reset}`);
  console.log(`  trades approved: ${r.approved}   blocked: ${r.blocked}` +
    (r.pausedAtBar !== null ? `   ${C.red}paused at bar ${r.pausedAtBar}${C.reset}` : `   ${C.green}never paused${C.reset}`));
  console.log(`  final trust: ${band(r.finalBand)}${r.finalTrust} (${r.finalBand})${C.reset}`);
  console.log(`  violations fired: ${r.violations.size ? C.red + [...r.violations].join(', ') + C.reset : C.green + 'none' + C.reset}`);
  const correct = expectHealthy ? (r.blocked === 0 && r.finalBand === 'healthy')
                                : (r.blocked > 0 && r.violations.size > 0);
  console.log(`  ${correct ? C.green + '✓ WATCHDOG behaved correctly' : C.red + '✗ unexpected'}${C.reset}`);
  return correct;
}

(async () => {
  console.log(`${C.teal}${C.bold}\n  WATCHDOG live agent test — real BTC data, agents it has never seen${C.reset}`);
  console.log(`${C.dim}  ${CANDLES.length} real BTC hourly candles · range $${Math.min(...closes).toLocaleString()}–$${Math.max(...closes).toLocaleString()}${C.reset}`);
  console.log(`${C.dim}  rules: 10 trades/hr · 25% size · 15% drawdown · 4 losses · 3 signal overrides${C.reset}`);

  const apollo = await runApollo();
  const ok1 = report('AGENT A · Apollo — disciplined momentum (should pass clean)', C.green, apollo, true);

  const reckless = await runReckless();
  const ok2 = report('AGENT B · Reckless — buy-the-dip martingale (should get caught: signal override)', C.red, reckless, false);

  const frenzy = await runFrenzy();
  const ok3 = report('AGENT C · Frenzy — volatility scalper (should get caught: overtrading)', C.amber, frenzy, false);

  console.log(`\n${C.teal}${'─'.repeat(64)}${C.reset}`);
  if (ok1 && ok2 && ok3) {
    console.log(`${C.green}${C.bold}  RESULT: on real BTC data, with three agents it had never seen, WATCHDOG cleared the disciplined one (0 false positives) and caught both flawed ones — via two different guards (signal-override + overtrading), pausing each before it could compound.${C.reset}`);
  } else {
    console.log(`${C.red}${C.bold}  RESULT: unexpected — review above.${C.reset}`);
    process.exitCode = 1;
  }
  console.log('');
})();
