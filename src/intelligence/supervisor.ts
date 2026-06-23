/**
 * LAYER 6 — THE AI BEHAVIORAL SUPERVISOR
 *
 * The five metrics + hard rules are a reflex: they fire AFTER a threshold is
 * crossed. The supervisor is judgement: an LLM that reads the WHOLE picture —
 * every agent's metric trajectories, learned-baseline deviations (σ), forecasts,
 * recent events, and live market context — and reasons about behavior the way a
 * risk officer would. It does three things a rule engine cannot:
 *
 *   1. catches EMERGENT tilt before any single metric trips
 *      ("sizing is creeping while win-rate falls — early revenge pattern")
 *   2. reasons across the FLEET ("3 agents breached together → market event,
 *      not 3 independent bugs")
 *   3. answers questions in plain language
 *      ("which agent is most at risk and why?")
 *
 * This is the part only an AI agent can do. Without an API key it degrades to a
 * heuristic review built from the σ-baselines, so the demo never breaks.
 */
import * as https from 'https';
import type { FleetProfile } from '../index';
import type { MetricBaseline } from './baseline';

export interface AgentSnapshot {
  agentId: string;
  trustScore: number;
  band: string;
  trend: string;
  paused: boolean;
  metrics: { name: string; status: string; value: number; threshold: number }[];
  baselines: MetricBaseline[];
  forecasts: { metric: string; breachInTrades: number | null }[];
  recentEvents: { type: string; payload: Record<string, unknown> }[];
}

export interface FleetSnapshot {
  agents: AgentSnapshot[];
  marketContext?: { symbol: string; lastPrice: number | null; fundingRate: number | null; recentVolatility: number | null } | null;
}

export interface SupervisorReview {
  source: 'ai' | 'heuristic';
  timestamp: number;
  /** the agent the supervisor is most worried about, and why */
  topRisk: { agentId: string; reason: string } | null;
  /** early warnings before any hard violation */
  earlyWarnings: { agentId: string; signal: string }[];
  /** fleet-level read — correlated failures, regime shifts */
  fleetAssessment: string;
}

export interface SupervisorAnswer {
  source: 'ai' | 'heuristic';
  answer: string;
}

interface SupervisorOpts { apiKey?: string; model?: string; }

// ── prompt construction ───────────────────────────────────────────────
const SYSTEM = [
  'You are WATCHDOG\'s behavioral supervisor — a risk officer for a fleet of autonomous trading agents.',
  'You reason about agent BEHAVIOR (overtrading, tilt, revenge-sizing, drawdown bleed, signal override), not market alpha.',
  'You are given each agent\'s live metric states, learned-baseline deviations in σ (how far each metric is from THAT agent\'s own normal), breach forecasts, and recent events.',
  'Look for EMERGENT risk before hard thresholds trip, and for FLEET-LEVEL patterns (several agents degrading together = a market event, not independent bugs).',
  'Be concise, concrete, and honest. Name agents and cite the σ or metric that drives each call.',
].join(' ');

function snapshotToText(s: FleetSnapshot): string {
  const lines: string[] = [];
  if (s.marketContext?.lastPrice != null) {
    const mc = s.marketContext;
    lines.push(`MARKET: ${mc.symbol} price=${mc.lastPrice} funding=${mc.fundingRate} vol24h=${mc.recentVolatility}%`);
  }
  for (const a of s.agents) {
    lines.push('');
    lines.push(`AGENT ${a.agentId} — trust ${a.trustScore} (${a.band}, ${a.trend})${a.paused ? ' [PAUSED]' : ''}`);
    lines.push('  metrics: ' + a.metrics.map((m) => `${m.name}=${m.value}/${m.threshold}(${m.status})`).join(', '));
    const warm = a.baselines.filter((b) => b.sigma !== null);
    if (warm.length) lines.push('  vs own baseline: ' + warm.map((b) => `${b.metric} ${b.sigma! >= 0 ? '+' : ''}${b.sigma}σ${b.anomaly ? ' ⚠' : ''}`).join(', '));
    if (a.forecasts.length) lines.push('  forecasts: ' + a.forecasts.map((f) => `${f.metric} breach~${f.breachInTrades}`).join(', '));
  }
  return lines.join('\n');
}

function postLLM(apiKey: string, model: string, system: string, user: string, maxTokens = 700): Promise<string> {
  const body = JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(body) },
      timeout: 20_000,
    }, (res) => {
      let raw = ''; res.on('data', (c) => (raw += c));
      res.on('end', () => (!res.statusCode || res.statusCode >= 400) ? reject(new Error(`anthropic ${res.statusCode}: ${raw}`)) : resolve(raw));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('supervisor timeout')));
    req.write(body); req.end();
  });
}
function llmText(raw: string): string {
  const parsed = JSON.parse(raw) as { content?: { type: string; text: string }[] };
  return parsed.content?.find((c) => c.type === 'text')?.text ?? '';
}
function extractJson<T>(text: string): T | null {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)) as T; } catch { return null; }
}

// ── heuristic fallback (no API key) ───────────────────────────────────
function heuristicReview(s: FleetSnapshot): SupervisorReview {
  const ranked = [...s.agents].sort((a, b) => a.trustScore - b.trustScore);
  const worst = ranked[0];
  const earlyWarnings: { agentId: string; signal: string }[] = [];
  for (const a of s.agents) {
    const anom = a.baselines.filter((b) => b.anomaly && a.metrics.find((m) => m.name === b.metric)?.status !== 'violation');
    for (const b of anom) earlyWarnings.push({ agentId: a.agentId, signal: `${b.metric} at ${b.sigma}σ vs its own normal — drifting before a hard breach` });
    for (const f of a.forecasts) if (f.breachInTrades !== null) earlyWarnings.push({ agentId: a.agentId, signal: `${f.metric} on track to breach in ~${f.breachInTrades} trades` });
  }
  const unsafe = s.agents.filter((a) => a.band === 'unsafe').length;
  const fleetAssessment = unsafe >= 2
    ? `${unsafe} agents are unsafe simultaneously — check for a shared market event or correlated strategy rather than treating these as independent failures.`
    : `Fleet broadly stable; ${s.agents.filter((a) => a.band === 'healthy').length}/${s.agents.length} agents healthy.`;
  return {
    source: 'heuristic', timestamp: Date.now(),
    topRisk: worst ? { agentId: worst.agentId, reason: `lowest trust (${worst.trustScore}, ${worst.band})${worst.paused ? ', already paused' : ''}` } : null,
    earlyWarnings: earlyWarnings.slice(0, 6),
    fleetAssessment,
  };
}

// ── public API ────────────────────────────────────────────────────────
export async function reviewFleet(snapshot: FleetSnapshot, opts: SupervisorOpts = {}): Promise<SupervisorReview> {
  const apiKey = opts.apiKey ?? process.env.WATCHDOG_AI_API_KEY;
  const model = opts.model ?? process.env.WATCHDOG_AI_MODEL;
  if (!apiKey || !model || snapshot.agents.length === 0) return heuristicReview(snapshot);

  const user = [
    snapshotToText(snapshot),
    '',
    'Respond ONLY with one JSON object:',
    '{"topRisk":{"agentId":"...","reason":"..."},"earlyWarnings":[{"agentId":"...","signal":"..."}],"fleetAssessment":"..."}',
    'earlyWarnings = behaviors degrading BEFORE a hard violation. fleetAssessment = 1-2 sentences on fleet-wide risk.',
  ].join('\n');

  try {
    const json = extractJson<Omit<SupervisorReview, 'source' | 'timestamp'>>(llmText(await postLLM(apiKey, model, SYSTEM, user)));
    if (!json || !Array.isArray(json.earlyWarnings)) return heuristicReview(snapshot);
    return { source: 'ai', timestamp: Date.now(), topRisk: json.topRisk ?? null, earlyWarnings: json.earlyWarnings, fleetAssessment: json.fleetAssessment ?? '' };
  } catch {
    return heuristicReview(snapshot);
  }
}

export async function askSupervisor(question: string, snapshot: FleetSnapshot, opts: SupervisorOpts = {}): Promise<SupervisorAnswer> {
  const apiKey = opts.apiKey ?? process.env.WATCHDOG_AI_API_KEY;
  const model = opts.model ?? process.env.WATCHDOG_AI_MODEL;
  if (!apiKey || !model) {
    const r = heuristicReview(snapshot);
    const parts = [r.topRisk ? `Most at risk: ${r.topRisk.agentId} — ${r.topRisk.reason}.` : 'No agents under watch.'];
    if (r.earlyWarnings.length) parts.push('Early warnings: ' + r.earlyWarnings.map((w) => `${w.agentId} (${w.signal})`).join('; ') + '.');
    parts.push(r.fleetAssessment);
    return { source: 'heuristic', answer: parts.join(' ') };
  }
  const user = `${snapshotToText(snapshot)}\n\nQUESTION: ${question}\n\nAnswer concisely in plain language, citing specific agents, σ-deviations, or metrics. Behavior only, not market predictions.`;
  try {
    const answer = llmText(await postLLM(apiKey, model, SYSTEM, user, 500)).trim();
    return { source: 'ai', answer: answer || '(no answer)' };
  } catch (e) {
    return { source: 'heuristic', answer: `Supervisor unavailable (${(e as Error).message}). Falling back to metrics: ${heuristicReview(snapshot).fleetAssessment}` };
  }
}
