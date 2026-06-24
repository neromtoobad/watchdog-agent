/**
 * seed.ts — build a deterministic, populated WATCHDOG fleet.
 *
 * Used by the Vercel serverless deployment so any visitor lands on a live-
 * looking dashboard (ranked leaderboard, an agent mid-incident, a real trade
 * ledger, a working AI Risk Officer) WITHOUT a running process or an API key.
 *
 * Every misbehaviour here is the same deterministic pattern the chaos harness
 * proves WATCHDOG catches — this is the benchmark made visible, not faked data.
 *
 * The returned Watchdog is the "primary" agent the single-agent views
 * (/api/status, /api/ledger, /api/audit) read from.
 */
import { Watchdog, WatchdogConfig, WatchdogRules } from '../index';
import { clear } from '../intelligence/fleet';

const RULES: WatchdogRules = {
  maxTradesPerHour: 10,
  maxPositionSizePercent: 25,
  maxDrawdownPercent: 15,
  maxConsecutiveLosses: 4,
  maxSignalOverridesPerHour: 3,
};

function mk(agentId: string, ai = false): Watchdog {
  const cfg: WatchdogConfig = {
    agentId,
    portfolioUsdt: 10_000,
    rules: RULES,
    onViolation: 'log', // observe everything — let the bad agents keep digging
    ai: { enabled: ai }, // ai:true → templated diagnosis (no key needed) populates the incident card
    fleet: { register: true },
  };
  return new Watchdog(cfg);
}

let primaryCache: Watchdog | null = null;
let seeding: Promise<Watchdog> | null = null;

async function build(): Promise<Watchdog> {
  clear(); // start from an empty fleet

  // 1 — well-behaved control. Stays green, sits on top of the leaderboard.
  const control = mk('alpha-control');
  for (let i = 0; i < 4; i++) {
    await control.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 200, direction: 'long' });
    control.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: i % 2 ? 140 : 90 });
  }

  // 2 — overtrader. 16 opens in minutes → frequency violation (the 238-trades pattern).
  const over = mk('bravo-overtrader');
  for (let i = 0; i < 16; i++) {
    await over.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 120, direction: 'long' });
  }

  // 3 — signal-flipper. States bearish, keeps opening longs → signalOverride violation (tilt).
  const flip = mk('delta-flipper');
  for (let i = 0; i < 5; i++) {
    flip.reportSignal({ signal: 'bearish', action: 'open-long' });
    await flip.checkTrade({ type: 'open', symbol: 'ETHUSDT', sizeUsdt: 150, direction: 'long' });
  }

  // 4 — revenge-trader. Doubles size into losses → positionDrift + lossStreak violation.
  const rev = mk('echo-revenge');
  let size = 200;
  for (let i = 0; i < 6; i++) {
    await rev.checkTrade({ type: 'open', symbol: 'SOLUSDT', sizeUsdt: size, direction: 'long' });
    rev.reportTradeClosed({ symbol: 'SOLUSDT', pnlUsdt: -120 });
    size += 600;
  }

  // 5 — PRIMARY: charlie-bleeder. Two wins, then a losing run → drawdown + lossStreak
  //     violation, which fires the AI incident report (templated fallback, no key).
  const charlie = mk('charlie-bleeder', /* ai */ true);
  await charlie.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 300, direction: 'long' });
  charlie.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 180 });
  await charlie.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 300, direction: 'long' });
  charlie.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 120 });
  for (let i = 0; i < 6; i++) {
    await charlie.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 400, direction: 'long' });
    charlie.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -320 });
  }
  await charlie.flushDiagnosis(); // ensure the incident report is ready before first request

  return charlie;
}

/** Build the fleet once per process; subsequent calls return the cached primary agent. */
export async function seedFleet(): Promise<Watchdog> {
  if (primaryCache) return primaryCache;
  if (!seeding) seeding = build().then((w) => (primaryCache = w));
  return seeding;
}
