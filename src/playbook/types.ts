/**
 * Bitget GetAgent Playbook control-plane response types.
 *
 * Source of truth: @bitget-ai/getagent-skill v0.2.1
 *   skills/getagent/references/api/run.md
 *
 * These types model what `POST /api/v1/playbook/run` dispatches and what
 * `GET /api/v1/playbook/run?run_id=...` returns once `status === 'completed'`.
 */

export type PlaybookRunStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * One emit_signal() call from inside the Playbook sandbox runtime.
 *
 * Standard fields per the API reference:
 *   action       — the strategy's recommendation
 *   symbol       — e.g. "BTCUSDT"
 *   confidence   — 0..1 model confidence
 *   metrics      — strategy-defined numbers (Sharpe, win_rate, sizeUsdt, pnlUsdt…)
 *   meta         — strategy-defined annotations
 *   timestamp    — wall-clock or sim-clock ms (optional; per-trade strategies set it)
 *
 * The demo Playbook (btc-ema-cross-demo) emits ONE summary signal at end of run.
 * A per-decision strategy emits one signal per trade entry/exit/hold.
 */
export interface PlaybookSignal {
  type: 'signal';
  action: string;            // 'long' | 'short' | 'close' | 'flat' | 'watch' | 'hold' | …
  symbol: string;
  confidence: number;
  metrics?: Record<string, number | string | null | undefined>;
  meta?: Record<string, unknown>;
  timestamp?: number;
}

export interface PlaybookMetricsOutput {
  total_return_pct?: number;
  net_pnl?: number;
  starting_balance?: number;
  sharpe_ratio?: number;
  max_drawdown_pct?: number;
  win_rate?: number;
  total_trades?: number;
  profit_factor?: number;
  [k: string]: unknown;
}

export interface PlaybookBacktestReport {
  period_start?: string;
  period_end?: string;
  [k: string]: unknown;
}

export interface PlaybookRunResponse {
  run_id: string;
  playbook_id?: string;
  strategy_id?: string;
  version_id?: string;
  status: PlaybookRunStatus;
  active_runtime_ms?: number;
  signal_output?: PlaybookSignal[];
  metrics_output?: PlaybookMetricsOutput;
  backtest_report?: PlaybookBacktestReport;
  failure_reason?: string;
  dispatched?: boolean;
}
