/**
 * paper-trade.ts — a REAL agent trading on REAL Bitget data, gated live by WATCHDOG.
 *
 * This is the "runnability" demo the hackathon explicitly rewards
 * (live/paper > backtest > concept). A momentum agent:
 *   1. pulls the LIVE BTCUSDT price from Bitget via `bgc --read-only`
 *      (no credentials needed — real market data from Bitget Agent Hub)
 *   2. forms a decision from the live price series
 *   3. asks WATCHDOG for permission BEFORE every order  ← the gate
 *   4. if approved: places the order
 *        · with Bitget Demo API keys in .env → a REAL demo (paper) order
 *        · without keys → "signal-only" (logs the order it WOULD place)
 *   5. reports the outcome back to WATCHDOG
 *
 *   npx ts-node examples/paper-trade.ts
 *
 * To place real Bitget demo orders, add a Demo API Key to .env:
 *   BITGET_DEMO_API_KEY=...    BITGET_DEMO_SECRET_KEY=...    BITGET_DEMO_PASSPHRASE=...
 * (Create one in Bitget → Demo Trading → API. Live keys will NOT work for paper trading.)
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { Watchdog, WatchdogConfig } from '../src/index';

const exec = promisify(execFile);

// load .env
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SYMBOL = 'BTCUSDT';
const TICKS = 12;
const TICK_MS = 2500;
const hasDemoKeys = !!(process.env.BITGET_DEMO_API_KEY && process.env.BITGET_DEMO_SECRET_KEY && process.env.BITGET_DEMO_PASSPHRASE);

const C = { reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[38;5;42m', amber: '\x1b[38;5;221m', red: '\x1b[38;5;203m', teal: '\x1b[38;5;43m' };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** live BTC price from Bitget, read-only — the monitor can never place an order on this path */
async function livePrice(): Promise<number | null> {
  try {
    const { stdout } = await exec('bgc', ['--read-only', 'spot', 'spot_get_ticker', '--symbol', SYMBOL], { timeout: 10_000 });
    const last = JSON.parse(stdout)?.data?.[0]?.lastPr;
    const n = Number(last);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/** place a Bitget DEMO (paper) order — only with demo keys; returns an order id or a signal-only marker */
async function placeOrder(side: 'buy' | 'sell', sizeUsdt: number, price: number): Promise<string> {
  if (!hasDemoKeys) return `signal-only (would ${side} ~$${sizeUsdt})`;
  const qty = (sizeUsdt / price).toFixed(6);
  try {
    const { stdout } = await exec('bgc', [
      '--paper-trading', 'spot', 'spot_place_order',
      '--symbol', SYMBOL, '--side', side, '--orderType', 'market', '--size', qty,
    ], {
      timeout: 12_000,
      env: {
        ...process.env,
        BITGET_API_KEY: process.env.BITGET_DEMO_API_KEY,
        BITGET_SECRET_KEY: process.env.BITGET_DEMO_SECRET_KEY,
        BITGET_PASSPHRASE: process.env.BITGET_DEMO_PASSPHRASE,
      },
    });
    const id = JSON.parse(stdout)?.data?.orderId;
    return id ? `demo order ${id}` : `demo order placed`;
  } catch (e) {
    return `demo order failed (${(e as Error).message.split('\n')[0].slice(0, 60)})`;
  }
}

const cfg: WatchdogConfig = {
  agentId: 'live-momentum-bot',
  portfolioUsdt: 10_000,
  rules: { maxTradesPerHour: 6, maxPositionSizePercent: 25, maxDrawdownPercent: 12, maxConsecutiveLosses: 4, maxSignalOverridesPerHour: 3 },
  onViolation: 'pause',
  ai: { enabled: !!process.env.WATCHDOG_AI_API_KEY },
  fleet: { register: true },
};

(async () => {
  console.log(`${C.teal}${C.bold}\n  WATCHDOG × Bitget — live paper-trading agent${C.reset}`);
  console.log(`${C.dim}  real BTCUSDT price via bgc --read-only · gated live by WATCHDOG${C.reset}`);
  console.log(`${C.dim}  order mode: ${hasDemoKeys ? C.green + 'REAL Bitget demo orders' : C.amber + 'signal-only (add Demo API keys for real paper orders)'}${C.reset}\n`);

  const first = await livePrice();
  if (first === null) {
    console.log(`${C.red}  ✗ could not reach Bitget market data (network/VPN). The agent needs live price to run.${C.reset}`);
    console.log(`${C.dim}    On a network that can reach api.bitget.com this runs against real BTC price.${C.reset}\n`);
    process.exit(0);
  }
  console.log(`  live BTCUSDT: $${first.toLocaleString()}\n`);

  const w = new Watchdog(cfg);
  const prices: number[] = [first];
  let entry: number | null = null;
  let approved = 0, blocked = 0, placed = 0;

  for (let i = 0; i < TICKS; i++) {
    await wait(TICK_MS);
    const p = await livePrice();
    if (p === null) continue;
    prices.push(p);
    if (prices.length < 4) { console.log(`  tick ${i + 1}: $${p.toLocaleString()} ${C.dim}(warming up)${C.reset}`); continue; }

    // simple momentum: 3-tick rate of change
    const roc = (p - prices[prices.length - 4]) / prices[prices.length - 4];
    const wantLong = roc > 0.0003;
    const wantExit = entry !== null && (roc < -0.0003);

    if (entry === null && wantLong) {
      w.reportSignal({ signal: 'bullish', action: 'open-long' });
      const d = await w.checkTrade({ type: 'open', symbol: SYMBOL, sizeUsdt: 1000, direction: 'long' });
      if (d.approved) {
        const res = await placeOrder('buy', 1000, p);
        if (res.startsWith('demo order ')) placed++;
        approved++; entry = p;
        console.log(`  tick ${String(i + 1).padStart(2)}: $${p.toLocaleString()}  ${C.green}▲ LONG approved${C.reset}  trust=${d.trustScore}  ${C.dim}${res}${C.reset}`);
      } else {
        blocked++;
        console.log(`  tick ${String(i + 1).padStart(2)}: $${p.toLocaleString()}  ${C.red}■ BLOCKED${C.reset}  ${d.reason}`);
      }
    } else if (entry !== null && wantExit) {
      const pnl = Math.round((p - entry) / entry * 1000);
      const d = await w.checkTrade({ type: 'close', symbol: SYMBOL, sizeUsdt: 1000, direction: 'long' });
      if (d.approved) {
        await placeOrder('sell', 1000, p);
        w.reportTradeClosed({ symbol: SYMBOL, pnlUsdt: pnl });
        const col = pnl >= 0 ? C.green : C.red;
        console.log(`  tick ${String(i + 1).padStart(2)}: $${p.toLocaleString()}  ${col}▼ CLOSE  pnl ${pnl >= 0 ? '+' : ''}${pnl}${C.reset}  trust=${w.getTrustScore().score}`);
        entry = null;
      } else {
        blocked++;
        console.log(`  tick ${String(i + 1).padStart(2)}: $${p.toLocaleString()}  ${C.red}■ exit BLOCKED${C.reset}  ${d.reason}`);
      }
    } else {
      console.log(`  tick ${String(i + 1).padStart(2)}: $${p.toLocaleString()}  ${C.dim}hold (roc ${(roc * 100).toFixed(3)}%)${C.reset}`);
    }
  }

  const t = w.getTrustScore();
  console.log(`\n${C.teal}  ── result ──${C.reset}`);
  console.log(`  approved: ${approved}   blocked: ${blocked}   real demo orders placed: ${placed}`);
  console.log(`  final trust: ${t.score} (${t.band})`);
  console.log(`  ${C.dim}WATCHDOG gated a real agent on real Bitget data${hasDemoKeys ? ' placing real demo orders' : ''}.${C.reset}\n`);
  process.exit(0);
})();
