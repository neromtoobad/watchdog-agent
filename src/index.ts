import { RingBuffer } from './store/buffer';
import { evaluateAll } from './engine/rules';
import { handleViolation } from './engine/actions';
import { computeTrust } from './intelligence/trustScore';
import { appendHistory, forecastBreaches } from './intelligence/forecast';
import { generateDiagnosis } from './intelligence/diagnosis';
import * as fleet from './intelligence/fleet';
import { AuditChain } from './intelligence/audit';
import { BaselineTracker, MetricBaseline } from './intelligence/baseline';
import { reviewFleet, askSupervisor } from './intelligence/supervisor';
import type { AgentSnapshot, FleetSnapshot, SupervisorReview, SupervisorAnswer } from './intelligence/supervisor';
import { renderBadge as renderTrustBadge } from './badge/render';
import { getMarketContext } from './market/context';
import type { RulesEvaluation } from './engine/rules';

// ────────────────────────────────────────────────────────────
// FROZEN PUBLIC TYPES — do not change signatures in later phases.
// ────────────────────────────────────────────────────────────

export type ViolationAction = 'pause' | 'alert' | 'log';
export type MetricStatus = 'ok' | 'warning' | 'violation';
export type TrustBand = 'healthy' | 'caution' | 'unsafe';
export type TrustTrend = 'up' | 'down' | 'flat';
export type TradeType = 'open' | 'close';
export type TradeDirection = 'long' | 'short';
export type EventType =
  | 'trade-open'
  | 'trade-close'
  | 'signal'
  | 'violation'
  | 'pause'
  | 'resume'
  | 'reset'
  | 'decision'
  | 'trust-update';

export interface WatchdogRules {
  maxTradesPerHour: number;
  maxPositionSizePercent: number;
  maxDrawdownPercent: number;
  maxConsecutiveLosses: number;
  maxSignalOverridesPerHour: number;
}

export interface WatchdogAIConfig {
  enabled: boolean;
  apiKey?: string;
  model?: string;
}

export interface WatchdogFleetConfig {
  register: boolean;
}

export interface WatchdogConfig {
  agentId: string;
  portfolioUsdt: number;
  rules: WatchdogRules;
  onViolation: ViolationAction;
  ai?: WatchdogAIConfig;
  fleet?: WatchdogFleetConfig;
}

export interface TradeRequest {
  type: TradeType;
  symbol: string;
  sizeUsdt: number;
  direction: TradeDirection;
}

export interface TradeClosed {
  symbol: string;
  pnlUsdt: number;
}

export interface SignalReport {
  signal: 'bullish' | 'bearish' | 'neutral';
  action: string;
}

export interface MetricResult {
  name: string;
  status: MetricStatus;
  value: number;
  threshold: number;
  detail: string;
}

export interface Forecast {
  metric: string;
  projection: number;
  breachInTrades: number | null;
  detail: string;
}

export interface TradeDecision {
  approved: boolean;
  reason: string | null;
  trustScore: number;
  forecasts: Forecast[];
  action: ViolationAction | null;
}

export interface TrustScore {
  score: number;
  band: TrustBand;
  trend: TrustTrend;
}

export interface WatchdogStatus {
  agentId: string;
  paused: boolean;
  trustScore: TrustScore;
  metrics: Record<string, MetricResult>;
}

export interface Diagnosis {
  timestamp: number;
  summary: string;
  likelyCause: string;
  recommendation: string;
  context: Record<string, unknown>;
  source: 'ai' | 'fallback';
}

export interface FleetProfile {
  agentId: string;
  trustScore: number;
  band: TrustBand;
  trend: TrustTrend;
  totalTrades: number;
  regimesSurvived: number;
  incidents: number;
  updatedAt: number;
}

export interface AuditEntry {
  timestamp: number;
  index: number;
  prevHash: string;
  hash: string;
  type: EventType;
  payload: Record<string, unknown>;
}

export interface WatchdogEvent {
  timestamp: number;
  type: EventType;
  payload: Record<string, unknown>;
}

// ────────────────────────────────────────────────────────────
// Watchdog class — public surface frozen. Internals are stubs
// to be filled in later phases.
// ────────────────────────────────────────────────────────────

export class Watchdog {
  private readonly config: WatchdogConfig;
  private readonly events: RingBuffer<WatchdogEvent>;
  private paused = false;
  private currentTrust: TrustScore = { score: 100, band: 'healthy', trend: 'flat' };
  private metricHistory: Record<string, number[]> = {};
  private currentForecasts: Forecast[] = [];
  private lastDiagnosis: Diagnosis | null = null;
  private diagnosisInflight: Promise<Diagnosis> | null = null;
  private prevOverall: MetricStatus = 'ok';
  private lastSymbol: string = 'BTCUSDT';
  private totalTrades = 0;
  private incidents = 0;
  private readonly audit = new AuditChain();
  private readonly baselines = new BaselineTracker();

  private static readonly TRUST_DROP_TRIGGER = 15;
  /** live instances, for the fleet supervisor (separate from the persistent fleet registry) */
  private static readonly liveAgents = new Map<string, Watchdog>();

  constructor(config: WatchdogConfig) {
    this.config = config;
    this.events = new RingBuffer<WatchdogEvent>(1000);
    if (config.fleet?.register) {
      fleet.register(config.agentId);
      Watchdog.liveAgents.set(config.agentId, this); // supervisor reviews the REGISTERED fleet only
    }
  }

  private intake(status: RulesEvaluation): void {
    const prevScore = this.currentTrust.score;
    for (const m of status.metrics) {
      appendHistory(this.metricHistory, m.name, m.value);
      this.baselines.observe(m.name, m.value);   // learn this agent's normal
    }
    this.currentTrust = computeTrust(status, prevScore);
    this.currentForecasts = forecastBreaches(this.metricHistory, this.config.rules);

    const newScore = this.currentTrust.score;
    const isNewViolation = this.prevOverall !== 'violation' && status.overall === 'violation';
    const sharpDrop = prevScore - newScore >= Watchdog.TRUST_DROP_TRIGGER;
    if (isNewViolation) {
      this.incidents++;
      this.audit.append('violation', { agentId: this.config.agentId, violations: status.violations });
    }
    this.audit.append('trust-update', {
      agentId: this.config.agentId,
      score: this.currentTrust.score,
      band: this.currentTrust.band,
      trend: this.currentTrust.trend,
    });
    if (this.config.ai?.enabled && (isNewViolation || sharpDrop)) {
      this.triggerDiagnosis(status);
    }
    this.prevOverall = status.overall;

    if (this.config.fleet?.register) {
      fleet.update(this.config.agentId, {
        trustScore: this.currentTrust.score,
        band: this.currentTrust.band,
        trend: this.currentTrust.trend,
        totalTrades: this.totalTrades,
        incidents: this.incidents,
      });
    }
  }

  private triggerDiagnosis(status: RulesEvaluation): void {
    if (this.diagnosisInflight) return;
    const symbol = this.lastSymbol;
    const apiKey = this.config.ai?.apiKey ?? process.env.WATCHDOG_AI_API_KEY;
    const model = this.config.ai?.model ?? process.env.WATCHDOG_AI_MODEL;
    this.diagnosisInflight = (async () => {
      let marketContext = null;
      try {
        marketContext = await getMarketContext(symbol);
      } catch {
        // degrade gracefully
      }
      const d = await generateDiagnosis({
        agentId: this.config.agentId,
        recentEvents: this.events.getAll().slice(-20),
        metricStates: status.metrics,
        marketContext,
        apiKey,
        model,
      });
      this.lastDiagnosis = d;
      return d;
    })().finally(() => {
      this.diagnosisInflight = null;
    });
  }

  /** Await any in-flight AI diagnosis. Returns the current cached diagnosis. */
  async flushDiagnosis(): Promise<Diagnosis | null> {
    if (this.diagnosisInflight) {
      try { await this.diagnosisInflight; } catch { /* swallow */ }
    }
    return this.lastDiagnosis;
  }

  private recomputeAll(): RulesEvaluation {
    const ev = evaluateAll(
      this.events.getAll(),
      this.config.rules,
      this.config.portfolioUsdt,
      Date.now(),
    );
    this.intake(ev);
    return ev;
  }

  async checkTrade(t: TradeRequest): Promise<TradeDecision> {
    let decision: TradeDecision;

    if (this.paused) {
      decision = {
        approved: false,
        reason: 'agent paused by watchdog',
        trustScore: this.currentTrust.score,
        forecasts: this.currentForecasts.slice(),
        action: 'pause',
      };
      this.audit.append('decision', { agentId: this.config.agentId, request: { ...t }, decision });
      return decision;
    }

    this.lastSymbol = t.symbol;
    this.totalTrades++;
    this.recordEvent('trade-open', { ...t });

    const status = evaluateAll(
      this.events.getAll(),
      this.config.rules,
      this.config.portfolioUsdt,
      Date.now(),
    );
    this.intake(status);
    const forecasts = this.currentForecasts.slice();

    if (status.overall === 'violation') {
      this.recordEvent('violation', {
        violations: status.violations,
        metrics: status.metrics,
      });
      const outcome = handleViolation(this.config.onViolation, status, (p) => {
        this.paused = p;
        if (p) this.recordEvent('pause', { reason: status.violations });
      });
      decision = outcome.block
        ? {
            approved: false,
            reason: outcome.reasons.join(' | ') || 'violation',
            trustScore: this.currentTrust.score,
            forecasts,
            action: outcome.action,
          }
        : {
            approved: true,
            reason: outcome.reasons.join(' | ') || null,
            trustScore: this.currentTrust.score,
            forecasts,
            action: outcome.action,
          };
    } else {
      decision = {
        approved: true,
        reason: null,
        trustScore: this.currentTrust.score,
        forecasts,
        action: null,
      };
    }

    this.audit.append('decision', { agentId: this.config.agentId, request: { ...t }, decision });
    return decision;
  }

  reportTradeClosed(c: TradeClosed): void {
    this.lastSymbol = c.symbol;
    this.recordEvent('trade-close', { ...c });
    this.recomputeAll();
  }

  reportSignal(r: SignalReport): void {
    this.recordEvent('signal', { ...r });
  }

  getStatus(): WatchdogStatus {
    const evalRes = evaluateAll(
      this.events.getAll(),
      this.config.rules,
      this.config.portfolioUsdt,
      Date.now(),
    );
    const metrics: Record<string, MetricResult> = {};
    for (const m of evalRes.metrics) metrics[m.name] = m;
    return {
      agentId: this.config.agentId,
      paused: this.paused,
      trustScore: this.getTrustScore(),
      metrics,
    };
  }

  getTrustScore(): TrustScore {
    return { ...this.currentTrust };
  }

  /** Learned per-agent behavioral baselines (deviation from this agent's own normal, in σ). */
  getBaselines(): MetricBaseline[] {
    return this.baselines.all();
  }

  /** The single most-anomalous metric vs. this agent's learned normal. */
  getTopAnomaly(): MetricBaseline | null {
    return this.baselines.topAnomaly();
  }

  getForecast(): Forecast[] {
    return this.currentForecasts.slice();
  }

  getLastDiagnosis(): Diagnosis | null {
    return this.lastDiagnosis;
  }

  getAuditTrail(): AuditEntry[] {
    return this.audit.getTrail();
  }

  verifyAuditChain(): { valid: boolean; brokenAt: number | null } {
    return this.audit.verify();
  }

  getEvents(): WatchdogEvent[] {
    const all = this.events.getAll();
    return all.slice(-50);
  }

  reset(): void {
    this.events.clear();
    this.paused = false;
    this.currentTrust = { score: 100, band: 'healthy', trend: 'flat' };
    this.metricHistory = {};
    this.currentForecasts = [];
    this.lastDiagnosis = null;
    this.prevOverall = 'ok';
    this.totalTrades = 0;
    this.incidents = 0;
    this.audit.clear();
    this.baselines.clear();
    this.recordEvent('reset', { agentId: this.config.agentId });
  }

  static getLeaderboard(): FleetProfile[] {
    return fleet.getLeaderboard();
  }

  /** A point-in-time behavioral snapshot of this agent for the supervisor. */
  snapshot(): AgentSnapshot {
    const st = this.getStatus();
    return {
      agentId: this.config.agentId,
      trustScore: st.trustScore.score,
      band: st.trustScore.band,
      trend: st.trustScore.trend,
      paused: st.paused,
      metrics: Object.values(st.metrics).map((m) => ({ name: m.name, status: m.status, value: m.value, threshold: m.threshold })),
      baselines: this.getBaselines(),
      forecasts: this.getForecast().map((f) => ({ metric: f.metric, breachInTrades: f.breachInTrades })),
      recentEvents: this.getEvents().slice(-12).map((e) => ({ type: e.type, payload: e.payload })),
    };
  }

  /** Snapshot of every live agent + optional market context. */
  static fleetSnapshot(marketContext?: FleetSnapshot['marketContext']): FleetSnapshot {
    return { agents: [...Watchdog.liveAgents.values()].map((w) => w.snapshot()), marketContext: marketContext ?? null };
  }

  /** LAYER 6 — the AI supervisor reasons over the whole fleet. */
  static async reviewFleet(): Promise<SupervisorReview> {
    return reviewFleet(Watchdog.fleetSnapshot());
  }

  /** Ask the AI supervisor a plain-language question about the fleet. */
  static async askSupervisor(question: string): Promise<SupervisorAnswer> {
    return askSupervisor(question, Watchdog.fleetSnapshot());
  }

  static renderBadge(agentId: string): string {
    const profile = fleet.getLeaderboard().find((p) => p.agentId === agentId);
    const score = profile?.trustScore ?? 100;
    const band: TrustBand = profile?.band ?? 'healthy';
    return renderTrustBadge(agentId, score, band);
  }

  private recordEvent(type: EventType, payload: Record<string, unknown>): void {
    this.events.push({ timestamp: Date.now(), type, payload });
  }
}

export type { MetricBaseline } from './intelligence/baseline';
export type { AgentSnapshot, FleetSnapshot, SupervisorReview, SupervisorAnswer } from './intelligence/supervisor';
export { reviewFleet, askSupervisor } from './intelligence/supervisor';

export default Watchdog;
