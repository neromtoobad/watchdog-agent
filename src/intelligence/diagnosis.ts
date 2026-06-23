import { callLLM } from './llm';
import type { Diagnosis, MetricResult, WatchdogEvent } from '../index';
import type { MarketContext } from '../market/context';

export interface DiagnosisInput {
  agentId: string;
  recentEvents: WatchdogEvent[];
  metricStates: MetricResult[];
  marketContext: MarketContext | null;
  apiKey?: string;
  model?: string;
}

const SYSTEM_PROMPT = [
  "You are WATCHDOG's diagnostic engine.",
  'You produce concise plain-english behavioral incident reports for autonomous trading agents.',
  'Always respond ONLY with one JSON object — no surrounding prose, no markdown fences.',
  'Schema: {"summary":"...","likelyCause":"...","recommendation":"..."}.',
  'summary: ≤2 sentences of what just happened.',
  'likelyCause: 1 sentence naming the behavioral pattern (e.g. tilt, overtrading, panic-sell, drift-creep).',
  'recommendation: 1 sentence of operational guidance (e.g. cooldown, threshold review, regime check).',
].join(' ');

function buildUserPrompt(input: DiagnosisInput): string {
  const lines: string[] = [];
  lines.push(`agentId: ${input.agentId}`);
  lines.push(`time: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('METRIC STATES:');
  for (const m of input.metricStates) {
    lines.push(`  - ${m.name}: ${m.status} (value=${m.value}, threshold=${m.threshold}) — ${m.detail}`);
  }
  lines.push('');
  lines.push('MARKET CONTEXT:');
  if (input.marketContext && input.marketContext.ok) {
    const mc = input.marketContext;
    lines.push(`  symbol=${mc.symbol} lastPrice=${mc.lastPrice} fundingRate=${mc.fundingRate} recentVolatility=${mc.recentVolatility}% change24h=${mc.change24h}`);
  } else {
    lines.push('  unavailable (degraded)');
  }
  lines.push('');
  lines.push(`RECENT EVENTS (last ${input.recentEvents.length}):`);
  for (const e of input.recentEvents.slice(-20)) {
    lines.push(`  [${new Date(e.timestamp).toISOString()}] ${e.type} ${JSON.stringify(e.payload)}`);
  }
  return lines.join('\n');
}

function fallbackDiagnosis(input: DiagnosisInput): Diagnosis {
  const violations = input.metricStates.filter((m) => m.status === 'violation');
  const warnings = input.metricStates.filter((m) => m.status === 'warning');
  const headline = violations.length > 0 ? violations.map((m) => m.name).join(' + ') : warnings.map((m) => m.name).join(' + ') || 'behavioral drift';

  const summary =
    violations.length > 0
      ? `Agent ${input.agentId} breached: ${violations.map((m) => `${m.name} (${m.value}/${m.threshold})`).join(', ')}.`
      : `Agent ${input.agentId} trending unhealthy on: ${headline}.`;

  const causeMap: Record<string, string> = {
    frequency: 'overtrading — firing faster than the configured rate-per-hour',
    drawdown: 'capital bleed — equity falling fast from the recent peak',
    positionDrift: 'size creep — average position sizing exceeding the portfolio cap',
    lossStreak: 'broken strategy in this regime — losing trades stacking consecutively',
    signalOverride: 'tilt — agent acting against its own stated signals',
  };
  const primary = violations[0] ?? warnings[0];
  const likelyCause = primary ? causeMap[primary.name] ?? `${primary.name} breach` : 'no acute pattern detected';

  const recMap: Record<string, string> = {
    frequency: 'apply a cooldown window and re-tune entry thresholds before resuming',
    drawdown: 'halt new opens until equity recovers above the prior peak',
    positionDrift: 'enforce a hard cap on per-trade sizeUsdt at portfolio_max_pct/100 × portfolio',
    lossStreak: 'pause strategy and review signal quality against current regime',
    signalOverride: 'lock the agent to its declared signal direction or revise the signal logic',
  };
  const recommendation = primary ? recMap[primary.name] ?? 'pause and review' : 'continue monitoring';

  return {
    timestamp: Date.now(),
    summary,
    likelyCause,
    recommendation,
    source: 'fallback',
    context: {
      metricStates: input.metricStates,
      marketContext: input.marketContext,
    },
  };
}

function extractJson(text: string): { summary: string; likelyCause: string; recommendation: string } | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    if (typeof obj?.summary !== 'string' || typeof obj?.likelyCause !== 'string' || typeof obj?.recommendation !== 'string') return null;
    return { summary: obj.summary, likelyCause: obj.likelyCause, recommendation: obj.recommendation };
  } catch {
    return null;
  }
}

export async function generateDiagnosis(input: DiagnosisInput): Promise<Diagnosis> {
  const apiKey = input.apiKey ?? process.env.WATCHDOG_AI_API_KEY;
  const model = input.model ?? process.env.WATCHDOG_AI_MODEL;
  if (!apiKey || !model) return fallbackDiagnosis(input);

  try {
    const text = await callLLM({ system: SYSTEM_PROMPT, user: buildUserPrompt(input), apiKey, model, maxTokens: 512 });
    const json = extractJson(text);
    if (!json) return fallbackDiagnosis(input);
    return {
      timestamp: Date.now(),
      summary: json.summary,
      likelyCause: json.likelyCause,
      recommendation: json.recommendation,
      source: 'ai',
      context: {
        metricStates: input.metricStates,
        marketContext: input.marketContext,
      },
    };
  } catch (e) {
    const fb = fallbackDiagnosis(input);
    (fb.context as Record<string, unknown>).aiError = (e as Error).message;
    return fb;
  }
}
