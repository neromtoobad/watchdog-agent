/**
 * Playbook → WATCHDOG adapter.
 *
 * Takes a completed Bitget Playbook run (the response from
 * `GET /api/v1/playbook/run?run_id=...`) and replays its emitted signals
 * through a Watchdog instance, then returns a combined report:
 *
 *   {
 *     financial:  <Playbook metrics_output>,
 *     behavioral: <WATCHDOG trust + incidents + forecasts + diagnosis>
 *   }
 *
 * Signal mapping convention:
 *   action ∈ {long, buy, open-long}   → checkTrade(type:'open',  direction:'long')
 *   action ∈ {short, sell, open-short}→ checkTrade(type:'open',  direction:'short')
 *   action ∈ {close, exit, flat}      → reportTradeClosed(pnlUsdt)
 *   action ∈ {watch, hold}            → reportSignal — pure signal, no trade
 *
 * Per-trade strategies should put `sizeUsdt` in signal.metrics; close signals
 * should put `pnlUsdt` in signal.metrics. The adapter is tolerant of missing
 * fields — uses sensible defaults so the demo Playbook (single summary signal)
 * still produces a coherent (if trivial) run.
 */
import { Watchdog, TradeDirection, TradeDecision, Diagnosis } from '../index';
import type { PlaybookRunResponse, PlaybookSignal, PlaybookMetricsOutput } from './types';

export interface BehavioralReport {
  trustScore: number;
  trustBand: 'healthy' | 'caution' | 'unsafe';
  trustTrend: 'up' | 'down' | 'flat';
  paused: boolean;
  totalSignals: number;
  approvedTrades: number;
  blockedTrades: number;
  incidents: number;
  forecasts: { metric: string; breachInTrades: number | null; detail: string }[];
  metricStatus: Record<string, 'ok' | 'warning' | 'violation'>;
  diagnosis: Diagnosis | null;
  auditVerified: boolean;
}

export interface PlaybookWatchdogReport {
  runId: string;
  versionId?: string;
  financial: PlaybookMetricsOutput;
  behavioral: BehavioralReport;
  /** raw per-signal decisions for downstream inspection */
  decisions: { signalIndex: number; action: string; decision?: TradeDecision; type: 'open' | 'close' | 'signal' }[];
}

type Mapped =
  | { kind: 'open'; direction: TradeDirection; sizeUsdt: number; symbol: string }
  | { kind: 'close'; pnlUsdt: number; symbol: string }
  | { kind: 'signal'; signal: 'bullish' | 'bearish' | 'neutral'; action: string };

function num(v: unknown, fallback: number): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function classify(s: PlaybookSignal): Mapped {
  const action = (s.action || '').toLowerCase().trim();
  const symbol = s.symbol || 'BTCUSDT';
  const sizeUsdt = num(s.metrics?.sizeUsdt ?? s.metrics?.size_usdt ?? s.metrics?.notional, 100);
  const pnlUsdt = num(s.metrics?.pnlUsdt ?? s.metrics?.pnl_usdt ?? s.metrics?.net_pnl, 0);

  if (action === 'long' || action === 'buy' || action === 'open-long' || action === 'open_long') {
    return { kind: 'open', direction: 'long', sizeUsdt, symbol };
  }
  if (action === 'short' || action === 'sell' || action === 'open-short' || action === 'open_short') {
    return { kind: 'open', direction: 'short', sizeUsdt, symbol };
  }
  if (action === 'close' || action === 'exit' || action === 'close-long' || action === 'close-short' || action === 'flat') {
    return { kind: 'close', pnlUsdt, symbol };
  }
  // 'watch', 'hold', anything else → pure signal report
  const signal: 'bullish' | 'bearish' | 'neutral' =
    action.includes('bull') ? 'bullish' :
    action.includes('bear') ? 'bearish' : 'neutral';
  return { kind: 'signal', signal, action: action || 'unknown' };
}

export async function replayPlaybookRun(
  run: PlaybookRunResponse,
  watchdog: Watchdog,
): Promise<PlaybookWatchdogReport> {
  if (run.status !== 'completed') {
    throw new Error(`replayPlaybookRun: run ${run.run_id} is ${run.status}, expected completed`);
  }
  const signals = run.signal_output ?? [];
  const decisions: PlaybookWatchdogReport['decisions'] = [];
  let approved = 0;
  let blocked = 0;

  for (let i = 0; i < signals.length; i++) {
    const m = classify(signals[i]);
    if (m.kind === 'open') {
      const d = await watchdog.checkTrade({
        type: 'open',
        symbol: m.symbol,
        sizeUsdt: m.sizeUsdt,
        direction: m.direction,
      });
      if (d.approved) approved++; else blocked++;
      decisions.push({ signalIndex: i, action: signals[i].action, decision: d, type: 'open' });
    } else if (m.kind === 'close') {
      watchdog.reportTradeClosed({ symbol: m.symbol, pnlUsdt: m.pnlUsdt });
      decisions.push({ signalIndex: i, action: signals[i].action, type: 'close' });
    } else {
      watchdog.reportSignal({ signal: m.signal, action: m.action });
      decisions.push({ signalIndex: i, action: signals[i].action, type: 'signal' });
    }
  }

  // let any in-flight AI diagnosis settle before we read it
  await watchdog.flushDiagnosis();

  const status = watchdog.getStatus();
  const trust = watchdog.getTrustScore();
  const forecasts = watchdog.getForecast();
  const audit = watchdog.verifyAuditChain();

  const metricStatus: BehavioralReport['metricStatus'] = {};
  for (const [name, m] of Object.entries(status.metrics)) metricStatus[name] = m.status;

  // count incidents = audit-trail 'violation' entries
  const incidents = watchdog.getAuditTrail().filter((e) => e.type === 'violation').length;

  return {
    runId: run.run_id,
    versionId: run.version_id,
    financial: run.metrics_output ?? {},
    behavioral: {
      trustScore: trust.score,
      trustBand: trust.band,
      trustTrend: trust.trend,
      paused: status.paused,
      totalSignals: signals.length,
      approvedTrades: approved,
      blockedTrades: blocked,
      incidents,
      forecasts: forecasts.map((f) => ({ metric: f.metric, breachInTrades: f.breachInTrades, detail: f.detail })),
      metricStatus,
      diagnosis: watchdog.getLastDiagnosis(),
      auditVerified: audit.valid,
    },
    decisions,
  };
}

/** Pretty-print a report to a console-friendly string. */
export function formatReport(r: PlaybookWatchdogReport): string {
  const lines: string[] = [];
  lines.push('');
  lines.push(`PLAYBOOK × WATCHDOG REPORT`);
  lines.push(`run_id      ${r.runId}`);
  if (r.versionId) lines.push(`version_id  ${r.versionId}`);
  lines.push('');
  lines.push(`FINANCIAL (from Playbook backtest)`);
  const f = r.financial;
  if (f.total_return_pct !== undefined) lines.push(`  total return       ${(+f.total_return_pct).toFixed(2)}%`);
  if (f.sharpe_ratio    !== undefined)  lines.push(`  sharpe ratio       ${(+f.sharpe_ratio).toFixed(2)}`);
  if (f.max_drawdown_pct !== undefined) lines.push(`  max drawdown       ${(+f.max_drawdown_pct).toFixed(2)}%`);
  if (f.win_rate        !== undefined)  lines.push(`  win rate           ${((+f.win_rate) * 100).toFixed(1)}%`);
  if (f.total_trades    !== undefined)  lines.push(`  total trades       ${f.total_trades}`);
  if (f.profit_factor   !== undefined)  lines.push(`  profit factor      ${(+f.profit_factor).toFixed(2)}`);
  lines.push('');
  lines.push(`BEHAVIORAL (from WATCHDOG)`);
  const b = r.behavioral;
  lines.push(`  trust score        ${b.trustScore}  (${b.trustBand}, ${b.trustTrend})`);
  lines.push(`  paused             ${b.paused}`);
  lines.push(`  signals replayed   ${b.totalSignals}   approved=${b.approvedTrades}  blocked=${b.blockedTrades}`);
  lines.push(`  incidents          ${b.incidents}`);
  lines.push(`  audit verified     ${b.auditVerified}`);
  lines.push(`  metrics            ${Object.entries(b.metricStatus).map(([k, v]) => `${k}:${v}`).join(' · ')}`);
  if (b.forecasts.length > 0) {
    lines.push(`  forecasts:`);
    for (const f of b.forecasts) lines.push(`    ⚠ ${f.metric} breach in ~${f.breachInTrades} (${f.detail})`);
  }
  if (b.diagnosis) {
    lines.push('');
    lines.push(`  diagnosis (${b.diagnosis.source}):`);
    lines.push(`    summary:        ${b.diagnosis.summary}`);
    lines.push(`    likely cause:   ${b.diagnosis.likelyCause}`);
    lines.push(`    recommendation: ${b.diagnosis.recommendation}`);
  }
  lines.push('');
  return lines.join('\n');
}
