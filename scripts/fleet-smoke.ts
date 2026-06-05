import * as fs from 'fs';
import { Watchdog, WatchdogConfig, WatchdogRules } from '../src/index';
import { clear, FLEET_PATH, getLeaderboard } from '../src/intelligence/fleet';

console.warn = () => {};

const baseRules: WatchdogRules = {
  maxTradesPerHour: 5,
  maxPositionSizePercent: 25,
  maxDrawdownPercent: 10,
  maxConsecutiveLosses: 3,
  maxSignalOverridesPerHour: 3,
};

function makeCfg(agentId: string): WatchdogConfig {
  return {
    agentId,
    portfolioUsdt: 10_000,
    rules: baseRules,
    onViolation: 'log',
    fleet: { register: true },
  };
}

async function main() {
  let passed = 0, failed = 0;
  const assert = (n: string, c: boolean, d?: string) => {
    if (c) { passed++; console.log(`  ok  ${n}`); }
    else   { failed++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); }
  };

  clear(); // start with empty fleet
  assert('fleet starts empty', getLeaderboard().length === 0);

  // ── three agents with intentionally different behaviour ────────────
  console.log('\n[creating 3 agents with different behaviours]');

  // A — well-behaved: 2 small trades, 2 wins
  const a = new Watchdog(makeCfg('agent-A-clean'));
  await a.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
  await a.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
  a.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 25 });
  a.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 30 });
  console.log('   A:', a.getTrustScore());

  // B — moderate: trips frequency but no losses
  const b = new Watchdog(makeCfg('agent-B-overtrader'));
  for (let i = 0; i < 8; i++) {
    await b.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
  }
  console.log('   B:', b.getTrustScore());

  // C — chaos: oversized rapid trades + heavy losses
  const c = new Watchdog(makeCfg('agent-C-chaos'));
  for (let i = 0; i < 15; i++) {
    await c.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 4000, direction: 'long' });
  }
  for (let i = 0; i < 6; i++) c.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -400 });
  console.log('   C:', c.getTrustScore());

  // ── leaderboard ────────────────────────────────────────────────────
  console.log('\n[leaderboard via Watchdog.getLeaderboard()]');
  const board = Watchdog.getLeaderboard();
  for (const p of board) console.log(`   ${p.trustScore.toString().padStart(3)} (${p.band})  ${p.agentId}  trades=${p.totalTrades} incidents=${p.incidents} trend=${p.trend}`);

  assert('three profiles present', board.length === 3);
  assert('ranked by trustScore desc', board[0].trustScore >= board[1].trustScore && board[1].trustScore >= board[2].trustScore);
  assert('A is on top', board[0].agentId === 'agent-A-clean', `top=${board[0].agentId}`);
  assert('C is on the bottom', board[board.length - 1].agentId === 'agent-C-chaos', `bottom=${board[board.length - 1].agentId}`);

  // counters
  const pA = board.find(p => p.agentId === 'agent-A-clean')!;
  const pB = board.find(p => p.agentId === 'agent-B-overtrader')!;
  const pC = board.find(p => p.agentId === 'agent-C-chaos')!;
  assert('A totalTrades=2', pA.totalTrades === 2);
  assert('B totalTrades=8', pB.totalTrades === 8);
  assert('C totalTrades=15', pC.totalTrades === 15);
  assert('A incidents=0', pA.incidents === 0);
  assert('B incidents≥1 (frequency tripped)', pB.incidents >= 1);
  assert('C incidents≥1 (frequency + drift + drawdown)', pC.incidents >= 1);
  assert('updatedAt populated', pA.updatedAt > 0 && pB.updatedAt > 0 && pC.updatedAt > 0);

  // ── persistence ────────────────────────────────────────────────────
  console.log('\n[persistence: fleet.local.json]');
  assert('fleet.local.json file exists', fs.existsSync(FLEET_PATH));
  const onDisk = JSON.parse(fs.readFileSync(FLEET_PATH, 'utf8'));
  assert('on-disk has 3 entries', Array.isArray(onDisk) && onDisk.length === 3);
  console.log('   file:', FLEET_PATH);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
