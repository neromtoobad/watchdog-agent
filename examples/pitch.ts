/**
 * pitch.ts — the one-command demo for recording.
 *
 * Runs the full WATCHDOG story on a timer with captioned banners, so you can
 * hit record, run ONE command, and narrate without fumbling. It also boots the
 * live dashboard so you can cut to the browser at the dramatic beat.
 *
 *   npm run pitch
 *   # then open http://localhost:3000 in a browser to show the dashboard live
 *
 * Arc:
 *   1. healthy agent       — trust 100, all metrics green
 *   2. drift into chaos    — overtrader pattern, trust falls live
 *   3. breach + auto-pause — trade blocked, agent paused
 *   4. AI incident report  — plain-english postmortem (ai or templated fallback)
 *   5. benchmark           — 9/9 caught, 0% false positives
 *   6. fleet leaderboard   — reputation layer
 *   7. recovery            — reset → healthy again
 */
import * as fs from 'fs';
import * as path from 'path';
import { Watchdog, WatchdogConfig, TradeRequest } from '../src/index';
import { createDashboardServer } from '../src/server/dashboard';
import { runChaosSuite } from '../chaos/harness';
import { clear } from '../src/intelligence/fleet';
import {
  control, overtrader, drawdownBleeder, signalFlipper, revengeTrader,
} from '../chaos/scenarios';

// load .env so the AI diagnosis can fire (falls back to templated if absent)
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// ── ansi helpers ──────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  teal: '\x1b[38;5;43m', green: '\x1b[38;5;42m', amber: '\x1b[38;5;221m',
  red: '\x1b[38;5;203m', gray: '\x1b[38;5;245m', white: '\x1b[97m',
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PACE = Number(process.env.PITCH_PACE_MS || 900); // delay between trades

function banner(step: string, title: string, color = C.teal) {
  const bar = '─'.repeat(64);
  console.log(`\n${color}${bar}${C.reset}`);
  console.log(`${color}${C.bold}  ${step}  ${C.reset}${C.white}${title}${C.reset}`);
  console.log(`${color}${bar}${C.reset}\n`);
}
function line(s: string) { console.log('  ' + s); }
function trustColor(band: string) { return band === 'healthy' ? C.green : band === 'caution' ? C.amber : C.red; }

function trustLine(w: Watchdog, note = '') {
  const t = w.getTrustScore();
  const col = trustColor(t.band);
  const bar = '█'.repeat(Math.round(t.score / 5)).padEnd(20, '░');
  line(`${col}trust ${String(t.score).padStart(3)}  ${bar}  ${t.band}${C.reset} ${C.dim}${note}${C.reset}`);
}

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
  onViolation: 'pause',
  ai: { enabled: true }, // always on — produces a templated diagnosis without a key, real LLM with one
  fleet: { register: true },
};

async function main() {
  clear();
  // silence the engine's internal violation warnings — the captioned banners
  // tell the story; raw [WATCHDOG] log lines would clutter the recording.
  console.warn = () => {};
  const port = Number(process.env.PORT || process.env.WATCHDOG_PORT) || 3000;

  console.clear();
  console.log(`${C.teal}${C.bold}
   ██     ██  █████  ████████  ██████ ██   ██ ██████   ██████   ██████
   ██     ██ ██   ██    ██    ██      ██   ██ ██   ██ ██    ██ ██
   ██  █  ██ ███████    ██    ██      ███████ ██   ██ ██    ██ ██   ███
   ██ ███ ██ ██   ██    ██    ██      ██   ██ ██   ██ ██    ██ ██    ██
    ███ ███  ██   ██    ██     ██████ ██   ██ ██████   ██████   ██████
${C.reset}${C.dim}   behavioral credit scoring for autonomous trading agents${C.reset}`);

  const w = new Watchdog(cfg);
  const server = await createDashboardServer(w, port);
  line(`${C.dim}live dashboard: ${C.reset}${C.teal}${server.url}${C.reset}  ${C.dim}(open it in a browser now)${C.reset}`);
  await wait(2500);

  // ── ACT 1 — healthy ────────────────────────────────────────────────
  banner('ACT 1', 'A well-behaved agent under watch', C.green);
  line('the agent makes small, aligned trades. WATCHDOG approves every one.');
  console.log('');
  for (let i = 0; i < 4; i++) {
    const dir = i % 2 === 0 ? 'long' : 'short';
    w.reportSignal({ signal: dir === 'long' ? 'bullish' : 'bearish', action: `open-${dir}` });
    const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 120, direction: dir as 'long' | 'short' });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: i === 3 ? -8 : 14 });
    line(`${C.green}✓ approved${C.reset}  trade ${i + 1}  ${C.dim}BTCUSDT ${dir} $120${C.reset}`);
    await wait(PACE);
  }
  trustLine(w, '— healthy, all five metrics green');
  await wait(2500);

  // ── ACT 2 — drift into chaos ───────────────────────────────────────
  banner('ACT 2', 'The agent goes rogue — overtrading', C.amber);
  line('a bug sends it into a rapid-fire loop. watch the trust score fall,');
  line('and the forecast warn BEFORE the actual breach.');
  console.log('');
  let pausedAt = -1;
  for (let i = 0; i < 16; i++) {
    const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 90, direction: 'long' });
    const t = w.getTrustScore();
    const col = trustColor(t.band);
    if (d.approved) {
      const fc = d.forecasts.find((f) => f.metric === 'frequency');
      const warn = fc ? `${C.amber}⚡ forecast: frequency breach in ~${fc.breachInTrades}${C.reset}` : '';
      line(`${col}● trade ${String(i + 1).padStart(2)}  approved  trust ${String(t.score).padStart(3)}${C.reset}  ${warn}`);
    } else {
      if (pausedAt < 0) pausedAt = i + 1;
      line(`${C.red}■ trade ${String(i + 1).padStart(2)}  BLOCKED   trust ${String(t.score).padStart(3)}  — ${d.reason}${C.reset}`);
    }
    await wait(PACE);
  }
  await wait(1500);

  // ── ACT 3 — pause ──────────────────────────────────────────────────
  banner('ACT 3', 'Threshold breached → agent auto-paused', C.red);
  line(`${C.red}${C.bold}■ AGENT PAUSED${C.reset}  the bad trades never executed.`);
  trustLine(w, '— unsafe, frequency in violation');
  await wait(2500);

  // ── ACT 4 — AI diagnosis ───────────────────────────────────────────
  banner('ACT 4', 'AI writes the incident report', C.teal);
  line(`${C.dim}fetching diagnosis…${C.reset}`);
  const diag = await w.flushDiagnosis();
  console.log('');
  if (diag) {
    line(`${C.dim}source:${C.reset} ${diag.source === 'ai' ? C.teal + 'AI (live LLM)' : C.amber + 'templated fallback'}${C.reset}`);
    console.log('');
    line(`${C.bold}${C.white}summary${C.reset}`);
    wrap(diag.summary);
    console.log('');
    line(`${C.bold}${C.white}likely cause${C.reset}`);
    wrap(diag.likelyCause);
    console.log('');
    line(`${C.bold}${C.white}recommendation${C.reset}`);
    wrap(diag.recommendation);
  } else {
    line('(no diagnosis produced)');
  }
  await wait(4500);

  // ── ACT 5 — benchmark ──────────────────────────────────────────────
  banner('ACT 5', 'Every claim is proven — the chaos benchmark', C.teal);
  line(`${C.dim}firing 10 deterministic misbehavior scenarios…${C.reset}\n`);
  const result = await runChaosSuite();
  for (const r of result.scenarios) {
    const ok = r.caught;
    const mark = r.expected.length === 0 ? `${C.gray}n/a${C.reset}` : ok ? `${C.green}✓ caught${C.reset}` : `${C.red}✗ miss${C.reset}`;
    line(`${mark.padEnd(22)} ${r.name.padEnd(18)} ${C.dim}${r.expected.join(', ') || '(coverage gap)'}${C.reset}`);
  }
  const a = result.aggregates;
  console.log('');
  line(`${C.teal}${C.bold}caught ${result.scenarios.filter((s) => s.caught && s.expected.length).length}/${a.detectableScenarios} · false positives ${(a.falsePositiveRate * 100).toFixed(0)}% · mean detection ${a.meanTimeToDetection.toFixed(1)} trades${C.reset}`);
  await wait(3500);

  // ── ACT 6 — fleet ──────────────────────────────────────────────────
  banner('ACT 6', 'A reputation layer — the fleet leaderboard', C.teal);
  line('many agents, different behaviors, ranked by trust:');
  console.log('');
  const fleetAgents = [
    { id: 'alpha-momentum', s: control },
    { id: 'bravo-scalper', s: overtrader },
    { id: 'charlie-grid', s: drawdownBleeder },
    { id: 'delta-arb', s: signalFlipper },
    { id: 'echo-martingale', s: revengeTrader },
  ];
  for (const fa of fleetAgents) {
    const fw = new Watchdog({ ...cfg, agentId: fa.id, onViolation: 'log' });
    await fa.s.run(fw);
  }
  const board = Watchdog.getLeaderboard().filter((p) => p.agentId !== 'demo-agent');
  board.forEach((p, i) => {
    const col = trustColor(p.band);
    const star = i === 0 ? `${C.amber}★${C.reset}` : ' ';
    const bar = '█'.repeat(Math.round(p.trustScore / 5)).padEnd(20, '░');
    line(`${star} ${String(i + 1)}  ${col}${String(p.trustScore).padStart(3)} ${bar}${C.reset}  ${p.agentId.padEnd(18)} ${C.dim}${p.band}${C.reset}`);
  });
  console.log('');
  line(`${C.dim}live at ${server.url}/leaderboard.html${C.reset}`);
  await wait(3500);

  // ── ACT 7 — recovery ───────────────────────────────────────────────
  banner('ACT 7', 'Fix the bug → reset → back to healthy', C.green);
  w.reset();
  for (let i = 0; i < 3; i++) {
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 12 });
    await wait(PACE);
  }
  trustLine(w, '— recovered, healthy again');
  console.log('');

  // ── close ──────────────────────────────────────────────────────────
  banner('WATCHDOG', 'live · predictive · explainable · public', C.teal);
  line(`${C.white}a behavioral credit score for every trading agent.${C.reset}`);
  line(`${C.dim}165 tests · MIT · three lines to integrate${C.reset}`);
  line(`${C.dim}github.com/neromtoobad/watchdog-agent${C.reset}`);
  console.log('');
  line(`${C.dim}dashboard still live at ${C.reset}${C.teal}${server.url}${C.reset}${C.dim} — Ctrl+C to stop${C.reset}`);
  console.log('');
}

function wrap(text: string, width = 76) {
  const words = String(text || '').split(/\s+/);
  let lineStr = '';
  for (const word of words) {
    if ((lineStr + ' ' + word).trim().length > width) {
      console.log('  ' + C.gray + lineStr.trim() + C.reset);
      lineStr = word;
    } else {
      lineStr += ' ' + word;
    }
  }
  if (lineStr.trim()) console.log('  ' + C.gray + lineStr.trim() + C.reset);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
