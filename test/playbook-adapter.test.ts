import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Watchdog, WatchdogConfig } from '../src/index';
import { replayPlaybookRun, formatReport } from '../src/playbook/adapter';
import type { PlaybookRunResponse } from '../src/playbook/types';
import { clear } from '../src/intelligence/fleet';

function mkCfg(): WatchdogConfig {
  return {
    agentId: 'playbook-test',
    portfolioUsdt: 10_000,
    rules: {
      maxTradesPerHour: 20,
      maxPositionSizePercent: 20,
      maxDrawdownPercent: 12,
      maxConsecutiveLosses: 4,
      maxSignalOverridesPerHour: 5,
    },
    onViolation: 'log',
    ai: { enabled: false },
  };
}

beforeEach(() => clear());

describe('replayPlaybookRun — adapter', () => {
  it('rejects a non-completed run', async () => {
    const w = new Watchdog(mkCfg());
    const run: PlaybookRunResponse = { run_id: 'x', status: 'failed', failure_reason: 'nope' };
    await expect(replayPlaybookRun(run, w)).rejects.toThrow(/failed.*expected completed/);
  });

  it('replays an empty signal_output as a zero-decision report', async () => {
    const w = new Watchdog(mkCfg());
    const run: PlaybookRunResponse = { run_id: 'empty', status: 'completed', signal_output: [], metrics_output: { total_return_pct: 0 } };
    const r = await replayPlaybookRun(run, w);
    expect(r.behavioral.totalSignals).toBe(0);
    expect(r.behavioral.approvedTrades).toBe(0);
    expect(r.behavioral.blockedTrades).toBe(0);
    expect(r.behavioral.auditVerified).toBe(true);
    expect(r.financial.total_return_pct).toBe(0);
  });

  it('maps long/short/buy/sell as opens, close/exit/flat as closes, hold as signal', async () => {
    const w = new Watchdog(mkCfg());
    const run: PlaybookRunResponse = {
      run_id: 'map', status: 'completed',
      signal_output: [
        { type: 'signal', action: 'long',  symbol: 'BTCUSDT', confidence: 0.7, metrics: { sizeUsdt: 100 } },
        { type: 'signal', action: 'close', symbol: 'BTCUSDT', confidence: 0.5, metrics: { pnlUsdt:  15 } },
        { type: 'signal', action: 'short', symbol: 'BTCUSDT', confidence: 0.7, metrics: { sizeUsdt: 100 } },
        { type: 'signal', action: 'exit',  symbol: 'BTCUSDT', confidence: 0.5, metrics: { pnlUsdt:  -5 } },
        { type: 'signal', action: 'buy',   symbol: 'BTCUSDT', confidence: 0.7, metrics: { sizeUsdt: 100 } },
        { type: 'signal', action: 'sell',  symbol: 'BTCUSDT', confidence: 0.7, metrics: { sizeUsdt: 100 } },
        { type: 'signal', action: 'flat',  symbol: 'BTCUSDT', confidence: 0.4, metrics: { pnlUsdt:   0 } },
        { type: 'signal', action: 'hold',  symbol: 'BTCUSDT', confidence: 0.3, metrics: {} },
      ],
    };
    const r = await replayPlaybookRun(run, w);
    const kinds = r.decisions.map((d) => d.type);
    expect(kinds.filter((k) => k === 'open').length).toBe(4);
    expect(kinds.filter((k) => k === 'close').length).toBe(3);
    expect(kinds.filter((k) => k === 'signal').length).toBe(1);
  });

  it('uses default sizeUsdt=100 when metrics.sizeUsdt is missing', async () => {
    const w = new Watchdog(mkCfg());
    const run: PlaybookRunResponse = {
      run_id: 'defaults', status: 'completed',
      signal_output: [{ type: 'signal', action: 'long', symbol: 'BTCUSDT', confidence: 0.5 }],
    };
    const r = await replayPlaybookRun(run, w);
    expect(r.decisions[0].type).toBe('open');
    expect(r.decisions[0].decision?.approved).toBe(true);
  });

  it('accepts snake_case metric keys (size_usdt, pnl_usdt)', async () => {
    const w = new Watchdog(mkCfg());
    const run: PlaybookRunResponse = {
      run_id: 'snake', status: 'completed',
      signal_output: [
        { type: 'signal', action: 'long',  symbol: 'BTCUSDT', confidence: 0.7, metrics: { size_usdt: 500 } },
        { type: 'signal', action: 'close', symbol: 'BTCUSDT', confidence: 0.5, metrics: { pnl_usdt: -50 } },
      ],
    };
    const r = await replayPlaybookRun(run, w);
    expect(r.decisions.length).toBe(2);
  });

  it('the sample fixture loads, replays, and trips revenge-trader behavior', async () => {
    const fixturePath = path.join(__dirname, '..', 'docs', 'sample-outputs', 'playbook-run-sample.json');
    const run = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as PlaybookRunResponse;
    expect(run.status).toBe('completed');
    expect((run.signal_output ?? []).length).toBeGreaterThan(10);

    const w = new Watchdog(mkCfg());
    const r = await replayPlaybookRun(run, w);

    // financials passed through
    expect(r.financial.total_return_pct).toBe(-15.39);
    expect(r.financial.sharpe_ratio).toBe(-0.84);

    // behavior: fixture is designed to trip multiple metrics
    expect(r.behavioral.trustScore).toBeLessThan(80); // not healthy
    const violating = Object.entries(r.behavioral.metricStatus).filter(([, s]) => s === 'violation').map(([n]) => n);
    expect(violating.length).toBeGreaterThan(0);
    // revenge-tilt manifests on at least one of these:
    const tilt = violating.some((n) => ['positionDrift', 'lossStreak', 'drawdown'].includes(n));
    expect(tilt).toBe(true);

    expect(r.behavioral.auditVerified).toBe(true);
    expect(r.behavioral.incidents).toBeGreaterThan(0);
  });

  it('formatReport produces a readable multi-line string', async () => {
    const w = new Watchdog(mkCfg());
    const run: PlaybookRunResponse = {
      run_id: 'r1', version_id: 'v1', status: 'completed',
      signal_output: [{ type: 'signal', action: 'long', symbol: 'BTCUSDT', confidence: 0.7, metrics: { sizeUsdt: 100 } }],
      metrics_output: { total_return_pct: 12.3, sharpe_ratio: 1.5, max_drawdown_pct: 4, win_rate: 0.55, total_trades: 8 },
    };
    const r = await replayPlaybookRun(run, w);
    const out = formatReport(r);
    expect(out).toContain('FINANCIAL');
    expect(out).toContain('BEHAVIORAL');
    expect(out).toContain('total return');
    expect(out).toContain('trust score');
    expect(out).toContain('run_id      r1');
  });
});
