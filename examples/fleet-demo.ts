/**
 * fleet-demo.ts — 5 agents, 5 behaviours, one leaderboard.
 *
 * Spins up 5 Watchdog instances each running a different chaos scenario
 * concurrently. Boots the dashboard server, then drives the scenarios in
 * parallel with light pacing so the leaderboard visibly re-ranks as the
 * misbehaviours unfold. The well-behaved control stays on top, the bad
 * agents sink.
 *
 *   WATCHDOG_PORT=3000 npx ts-node examples/fleet-demo.ts
 *   open http://localhost:3000/leaderboard.html
 */
import { Watchdog, WatchdogConfig, WatchdogRules } from '../src/index';
import { createDashboardServer } from '../src/server/dashboard';
import { clear, getLeaderboard } from '../src/intelligence/fleet';
import { loadDotenv } from '../src/util/env';
loadDotenv(); // a WATCHDOG_AI_API_KEY in .env lights up the AI Risk Officer
import {
  control,
  overtrader,
  drawdownBleeder,
  signalFlipper,
  revengeTrader,
  Scenario,
} from '../chaos/scenarios';

const RULES: WatchdogRules = {
  maxTradesPerHour: 10,
  maxPositionSizePercent: 25,
  maxDrawdownPercent: 15,
  maxConsecutiveLosses: 4,
  maxSignalOverridesPerHour: 3,
};

function mkAgent(agentId: string): Watchdog {
  const cfg: WatchdogConfig = {
    agentId,
    portfolioUsdt: 10_000,
    rules: RULES,
    onViolation: 'log', // never block — we want the bad ones to keep digging
    fleet: { register: true },
  };
  return new Watchdog(cfg);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function banner(s: string) {
  const bar = '─'.repeat(s.length + 4);
  console.log(`\n${bar}\n  ${s}\n${bar}`);
}

// pace the scenario by intercepting checkTrade so the leaderboard
// has time to re-rank between actions
function pace(w: Watchdog, ms: number) {
  const orig = w.checkTrade.bind(w);
  (w as any).checkTrade = async (t: Parameters<Watchdog['checkTrade']>[0]) => {
    const r = await orig(t);
    if (ms > 0) await wait(ms);
    return r;
  };
}

interface Run {
  agentId: string;
  scenario: Scenario;
  label: string;
}

const ROSTER: Run[] = [
  { agentId: 'alpha-control',     scenario: control,         label: 'well-behaved (control)' },
  { agentId: 'bravo-overtrader',  scenario: overtrader,      label: 'overtrader (frequency)' },
  { agentId: 'charlie-bleeder',   scenario: drawdownBleeder, label: 'drawdown-bleeder (drawdown + lossStreak)' },
  { agentId: 'delta-flipper',     scenario: signalFlipper,   label: 'signal-flipper (signalOverride)' },
  { agentId: 'echo-revenge',      scenario: revengeTrader,   label: 'revenge-trader (positionDrift + lossStreak)' },
];

function snapshot() {
  const board = getLeaderboard();
  console.log('  rank  trust  band      agent                              trades  incidents  trend');
  console.log('  ' + '─'.repeat(86));
  board.forEach((p, i) => {
    const trend = p.trend === 'up' ? '↑' : p.trend === 'down' ? '↓' : '→';
    const star = i === 0 ? '★' : ' ';
    console.log(
      `  ${star} ${String(i + 1).padStart(2)}` +
      `   ${String(p.trustScore).padStart(3)}` +
      `   ${p.band.padEnd(8)}` +
      `  ${p.agentId.padEnd(34)}` +
      `   ${String(p.totalTrades).padStart(4)}` +
      `       ${String(p.incidents).padStart(2)}` +
      `      ${trend}`,
    );
  });
}

(async () => {
  banner('WATCHDOG fleet-demo — 5 agents, 5 behaviours, one leaderboard');

  clear(); // start with an empty fleet

  // build all 5 agents
  const agents = ROSTER.map((r) => ({ ...r, w: mkAgent(r.agentId) }));

  // boot the dashboard pointed at the control agent for /api/status;
  // /api/leaderboard surfaces all 5 from the fleet registry
  const port = Number(process.env.PORT || process.env.WATCHDOG_PORT) || 3000;
  await createDashboardServer(agents[0].w, port);

  console.log('\nopen the LEADERBOARD:  http://localhost:' + port + '/leaderboard.html');
  console.log('single-agent view:     http://localhost:' + port + '/   (control agent)');
  console.log('badges, e.g.:          http://localhost:' + port + '/badge/echo-revenge\n');

  console.log('roster:');
  for (const r of agents) console.log(`  · ${r.agentId.padEnd(34)} — ${r.label}`);
  console.log('');

  await wait(3_000);

  banner('driving all 5 scenarios concurrently…');

  // pace each watchdog so the dashboard polls catch the changes between actions
  for (const a of agents) pace(a.w, 250);

  // launch all scenarios in parallel
  const runs = agents.map((a) =>
    a.scenario
      .run(a.w)
      .then(() => console.log(`  ✓ ${a.agentId} scenario complete`))
      .catch((e) => console.error(`  ✗ ${a.agentId} failed: ${(e as Error).message}`)),
  );

  // periodic snapshots during the run
  const ticker = setInterval(() => {
    console.log(`\n[snapshot @ ${new Date().toLocaleTimeString()}]`);
    snapshot();
  }, 2_500);

  await Promise.all(runs);
  clearInterval(ticker);

  // small settle so the final updates land in the fleet
  await wait(500);

  banner('final leaderboard');
  snapshot();

  // sanity-check expectations
  const board = getLeaderboard();
  const top = board[0];
  const bottom = board[board.length - 1];
  console.log('');
  console.log(`  top:    ${top.agentId}  (trust ${top.trustScore}, ${top.band})`);
  console.log(`  bottom: ${bottom.agentId}  (trust ${bottom.trustScore}, ${bottom.band})`);
  const controlOnTop = top.agentId === 'alpha-control';
  const badAtBottom = bottom.trustScore < top.trustScore;
  console.log(`  control on top? ${controlOnTop ? 'YES' : 'NO'}    bad agent below control? ${badAtBottom ? 'YES' : 'NO'}`);

  banner('dashboard still live — leaderboard polls every 3 s. Ctrl+C to stop.');
})();
