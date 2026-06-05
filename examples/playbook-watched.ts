/**
 * playbook-watched.ts — pipe a Bitget Playbook backtest through WATCHDOG.
 *
 * Two modes:
 *
 *   1) LIVE:  set BITGET_ACCESS_KEY + PLAYBOOK_VERSION_ID in the environment.
 *             The script will POST /api/v1/playbook/run, poll, then replay.
 *
 *   2) SAMPLE: no env vars needed. Loads docs/sample-outputs/playbook-run-sample.json
 *              (a spec-accurate fixture) and replays it through WATCHDOG.
 *              Useful for demoing the integration without credentials.
 *
 * Either way, you get one combined report:
 *
 *   FINANCIAL  (from Playbook):  PnL, Sharpe, drawdown, win rate, trades
 *   BEHAVIORAL (from WATCHDOG):  trust score, paused?, incidents, forecasts, diagnosis
 *
 * The whole point: behavioral metrics catch failures that PnL alone hides.
 * Two strategies can both end at +5% PnL — but the one that tilts hard
 * mid-run has a low trust score and should not be deployed.
 *
 *   npx ts-node examples/playbook-watched.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { Watchdog, WatchdogConfig } from '../src/index';
import { replayPlaybookRun, formatReport } from '../src/playbook/adapter';
import { runPlaybook } from '../src/playbook/client';
import type { PlaybookRunResponse } from '../src/playbook/types';

// load .env (real, gitignored) first, then fall back to .env.example for any
// values not already present. Real secrets belong in .env; the .example file
// is only there so the WATCHDOG_AI_API_KEY for diagnosis is available.
for (const file of ['.env', '.env.example']) {
  const p = path.join(__dirname, '..', file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const SAMPLE_PATH = path.join(__dirname, '..', 'docs', 'sample-outputs', 'playbook-run-sample.json');

function banner(s: string) {
  const bar = '─'.repeat(s.length + 4);
  console.log(`\n${bar}\n  ${s}\n${bar}`);
}

async function loadRun(): Promise<{ run: PlaybookRunResponse; mode: 'live' | 'sample' }> {
  // BITGET_PLAYBOOK_KEY is the single bearer key issued by the Bitget team.
  // BITGET_ACCESS_KEY is the legacy OpenAPI key — fall back to it if set.
  const accessKey = process.env.BITGET_PLAYBOOK_KEY || process.env.BITGET_ACCESS_KEY;
  const versionId = process.env.PLAYBOOK_VERSION_ID;

  if (accessKey && versionId) {
    console.log(`LIVE mode: POST /api/v1/playbook/run for version_id=${versionId}…`);
    console.log(`  (key source: ${process.env.BITGET_PLAYBOOK_KEY ? 'BITGET_PLAYBOOK_KEY' : 'BITGET_ACCESS_KEY'})`);
    const run = await runPlaybook({ accessKey, versionId });
    return { run, mode: 'live' };
  }

  console.log('SAMPLE mode (neither BITGET_PLAYBOOK_KEY nor PLAYBOOK_VERSION_ID resolved).');
  console.log(`  loading fixture: ${SAMPLE_PATH}`);
  const run = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8')) as PlaybookRunResponse;
  return { run, mode: 'sample' };
}

async function main() {
  banner('WATCHDOG × Playbook — behavioral layer over a Bitget backtest');

  const { run, mode } = await loadRun();
  console.log(`  run_id:       ${run.run_id}`);
  console.log(`  version_id:   ${run.version_id ?? '(none)'}`);
  console.log(`  status:       ${run.status}`);
  console.log(`  signals:      ${run.signal_output?.length ?? 0}`);
  console.log(`  mode:         ${mode}`);

  if (run.status !== 'completed') {
    console.error(`run did not complete (${run.status}): ${run.failure_reason}`);
    process.exit(1);
  }

  // Build a WATCHDOG configured to watch this strategy.
  // Rules tuned to be reasonable for a 10k portfolio backtest:
  const cfg: WatchdogConfig = {
    agentId: `playbook-${run.version_id ?? run.run_id}`,
    portfolioUsdt: Number(run.metrics_output?.starting_balance ?? 10_000),
    rules: {
      maxTradesPerHour: 20,           // backtests fire fast in sim-time; loose
      maxPositionSizePercent: 20,     // tight — to catch revenge sizing
      maxDrawdownPercent: 12,
      maxConsecutiveLosses: 4,
      maxSignalOverridesPerHour: 5,
    },
    onViolation: 'log',               // we don't block the backtest — we score it
    ai: { enabled: !!process.env.WATCHDOG_AI_API_KEY },
    fleet: { register: true },        // appear on /api/leaderboard
  };
  const w = new Watchdog(cfg);

  banner('replaying signals through WATCHDOG…');
  const t0 = Date.now();
  const report = await replayPlaybookRun(run, w);
  console.log(`  ${report.decisions.length} signals replayed in ${Date.now() - t0}ms`);

  banner('combined report');
  console.log(formatReport(report));

  // verdict header
  const verdict =
    report.behavioral.trustBand === 'unsafe'   ? 'DO NOT DEPLOY — behavioral red flags'
  : report.behavioral.trustBand === 'caution'  ? 'REVIEW — behavioral warnings even though PnL may look fine'
  :                                              'CLEARED — financials and behavior both healthy';
  banner(`verdict: ${verdict}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
