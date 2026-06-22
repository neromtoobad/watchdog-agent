#!/usr/bin/env node
/**
 * WATCHDOG MCP server.
 *
 * Exposes WATCHDOG as Model Context Protocol tools so ANY agent that speaks
 * MCP — including an agent trading through Bitget's own MCP server — can gate
 * every trade through behavioral monitoring without importing the library.
 *
 * Run:
 *   npx watchdog-mcp
 *
 * Wire into Claude Code / Cursor / any MCP client:
 *   claude mcp add watchdog -- npx -y watchdog-agent watchdog-mcp
 *   # or point directly at the built file:
 *   claude mcp add watchdog -- node ./node_modules/watchdog-agent/dist/mcp/server.js
 *
 * Tools exposed:
 *   watchdog_register_agent   — (optional) configure an agent's rules
 *   watchdog_check_trade      — gate a trade BEFORE it executes  → approve/block + trust
 *   watchdog_report_closed    — report a closed position's PnL
 *   watchdog_report_signal    — report a stated signal (catches tilt)
 *   watchdog_get_status       — full status: 5 metrics + trust + paused
 *   watchdog_get_diagnosis    — latest AI incident report
 *   watchdog_get_leaderboard  — fleet ranking by trust
 *
 * Requires the optional peers `@modelcontextprotocol/sdk` and `zod`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Watchdog, WatchdogConfig, WatchdogRules, ViolationAction } from '../index';

// ── per-agent Watchdog registry ───────────────────────────────────────
const agents = new Map<string, Watchdog>();

const DEFAULT_RULES: WatchdogRules = {
  maxTradesPerHour: Number(process.env.WATCHDOG_MAX_TRADES_PER_HOUR ?? 10),
  maxPositionSizePercent: Number(process.env.WATCHDOG_MAX_POSITION_PCT ?? 25),
  maxDrawdownPercent: Number(process.env.WATCHDOG_MAX_DRAWDOWN_PCT ?? 15),
  maxConsecutiveLosses: Number(process.env.WATCHDOG_MAX_LOSS_STREAK ?? 4),
  maxSignalOverridesPerHour: Number(process.env.WATCHDOG_MAX_SIGNAL_OVERRIDES ?? 3),
};
const DEFAULT_PORTFOLIO = Number(process.env.WATCHDOG_PORTFOLIO_USDT ?? 10_000);
const DEFAULT_ACTION = (process.env.WATCHDOG_ON_VIOLATION as ViolationAction) ?? 'pause';

function getAgent(agentId: string, overrides?: Partial<WatchdogConfig>): Watchdog {
  let w = agents.get(agentId);
  if (!w) {
    const cfg: WatchdogConfig = {
      agentId,
      portfolioUsdt: overrides?.portfolioUsdt ?? DEFAULT_PORTFOLIO,
      rules: overrides?.rules ?? DEFAULT_RULES,
      onViolation: overrides?.onViolation ?? DEFAULT_ACTION,
      ai: overrides?.ai ?? { enabled: !!process.env.WATCHDOG_AI_API_KEY },
      fleet: { register: true },
    };
    w = new Watchdog(cfg);
    agents.set(agentId, w);
  }
  return w;
}

const ok = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

// ── server ────────────────────────────────────────────────────────────
const server = new McpServer({ name: 'watchdog', version: '0.1.0' });

server.registerTool('watchdog_register_agent', {
  description: 'Configure an agent\'s behavioral rules. Optional — agents are auto-created with sensible defaults on first check_trade. Call this to set custom thresholds.',
  inputSchema: {
    agentId: z.string().describe('unique agent identifier'),
    portfolioUsdt: z.number().optional().describe('account size in USDT, for % math'),
    maxTradesPerHour: z.number().optional(),
    maxPositionSizePercent: z.number().optional(),
    maxDrawdownPercent: z.number().optional(),
    maxConsecutiveLosses: z.number().optional(),
    maxSignalOverridesPerHour: z.number().optional(),
    onViolation: z.enum(['pause', 'alert', 'log']).optional().describe('what to do on a violation'),
  },
}, async (a) => {
  agents.delete(a.agentId); // re-create with new config
  const rules: WatchdogRules = {
    maxTradesPerHour: a.maxTradesPerHour ?? DEFAULT_RULES.maxTradesPerHour,
    maxPositionSizePercent: a.maxPositionSizePercent ?? DEFAULT_RULES.maxPositionSizePercent,
    maxDrawdownPercent: a.maxDrawdownPercent ?? DEFAULT_RULES.maxDrawdownPercent,
    maxConsecutiveLosses: a.maxConsecutiveLosses ?? DEFAULT_RULES.maxConsecutiveLosses,
    maxSignalOverridesPerHour: a.maxSignalOverridesPerHour ?? DEFAULT_RULES.maxSignalOverridesPerHour,
  };
  getAgent(a.agentId, { portfolioUsdt: a.portfolioUsdt, rules, onViolation: a.onViolation });
  return ok({ registered: a.agentId, rules, portfolioUsdt: a.portfolioUsdt ?? DEFAULT_PORTFOLIO });
});

server.registerTool('watchdog_check_trade', {
  description: 'Gate a trade BEFORE it executes. Call this before every order. Returns { approved, reason, trustScore, forecasts, action }. If approved is false, DO NOT place the order — the agent is misbehaving.',
  inputSchema: {
    agentId: z.string(),
    type: z.enum(['open', 'close']).describe('open a position or close one'),
    symbol: z.string().describe('e.g. BTCUSDT'),
    sizeUsdt: z.number().describe('notional size in USDT'),
    direction: z.enum(['long', 'short']),
  },
}, async (a) => {
  const w = getAgent(a.agentId);
  const decision = await w.checkTrade({ type: a.type, symbol: a.symbol, sizeUsdt: a.sizeUsdt, direction: a.direction });
  return ok(decision);
});

server.registerTool('watchdog_report_closed', {
  description: 'Report the outcome of a closed position so WATCHDOG can track drawdown and loss streaks.',
  inputSchema: {
    agentId: z.string(),
    symbol: z.string(),
    pnlUsdt: z.number().describe('realised PnL in USDT (negative for a loss)'),
  },
}, async (a) => {
  const w = getAgent(a.agentId);
  w.reportTradeClosed({ symbol: a.symbol, pnlUsdt: a.pnlUsdt });
  return ok({ recorded: true, trust: w.getTrustScore() });
});

server.registerTool('watchdog_report_signal', {
  description: 'Report the agent\'s stated signal alongside the action it took, so WATCHDOG can detect tilt (acting against your own signal).',
  inputSchema: {
    agentId: z.string(),
    signal: z.enum(['bullish', 'bearish', 'neutral']),
    action: z.string().describe('e.g. open-long, open-short'),
  },
}, async (a) => {
  const w = getAgent(a.agentId);
  w.reportSignal({ signal: a.signal, action: a.action });
  return ok({ recorded: true });
});

server.registerTool('watchdog_get_status', {
  description: 'Full behavioral status for an agent: the five metrics, trust score, band, trend, and whether it is paused.',
  inputSchema: { agentId: z.string() },
}, async (a) => {
  const w = getAgent(a.agentId);
  return ok({ status: w.getStatus(), forecasts: w.getForecast(), trust: w.getTrustScore() });
});

server.registerTool('watchdog_get_diagnosis', {
  description: 'The latest AI-generated incident report for an agent (or null if none).',
  inputSchema: { agentId: z.string() },
}, async (a) => {
  const w = getAgent(a.agentId);
  await w.flushDiagnosis();
  return ok({ diagnosis: w.getLastDiagnosis() });
});

server.registerTool('watchdog_get_leaderboard', {
  description: 'The fleet leaderboard — every registered agent ranked by trust score. No arguments.',
  inputSchema: {},
}, async () => ok({ leaderboard: Watchdog.getLeaderboard() }));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is the MCP transport
  process.stderr.write('[watchdog-mcp] ready — 7 tools exposed over stdio\n');
}

main().catch((e) => {
  process.stderr.write(`[watchdog-mcp] fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
