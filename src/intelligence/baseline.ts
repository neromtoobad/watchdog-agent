/**
 * LAYER 5 — LEARNED BEHAVIORAL BASELINES
 *
 * Static thresholds ("max 10 trades/hour") assume you know what normal looks
 * like for an agent. You usually don't. WATCHDOG instead *learns* each agent's
 * own normal for every metric and scores how far the current value deviates —
 * in standard deviations (σ) — from that agent's personal baseline.
 *
 * "238 trades is 6.2σ above THIS agent's normal" is a far stronger statement
 * than "238 > 10". A high-frequency market-maker and a swing bot have wildly
 * different normals; one global threshold can't fairly judge both. Baselines can.
 *
 * This is additive: it never overrides the hard rules (those still drive the
 * pause/trust path). It surfaces a per-agent anomaly signal that the AI
 * supervisor reasons over and the dashboard displays.
 */

export interface MetricBaseline {
  metric: string;
  samples: number;
  mean: number;
  std: number;
  current: number;
  /** deviation of current value from this agent's baseline, in σ (null until warm) */
  sigma: number | null;
  /** true once the anomaly threshold is crossed on a warm baseline */
  anomaly: boolean;
}

const WINDOW = 50;          // rolling samples kept per metric
const WARMUP = 8;           // need this many before σ is meaningful
const ANOMALY_SIGMA = 3;    // |z| beyond this = behavioral anomaly

export class BaselineTracker {
  private readonly series: Record<string, number[]> = {};

  /** record a new observation for a metric */
  observe(metric: string, value: number): void {
    const arr = this.series[metric] ?? (this.series[metric] = []);
    arr.push(value);
    if (arr.length > WINDOW) arr.splice(0, arr.length - WINDOW);
  }

  /**
   * Baseline for one metric. The baseline is computed over all-but-the-latest
   * sample so the current value is scored against the agent's *prior* normal,
   * not a normal that already includes the spike we're testing.
   */
  baseline(metric: string): MetricBaseline | null {
    const arr = this.series[metric];
    if (!arr || arr.length === 0) return null;
    const current = arr[arr.length - 1];
    const prior = arr.slice(0, -1);

    if (prior.length < WARMUP) {
      return { metric, samples: arr.length, mean: current, std: 0, current, sigma: null, anomaly: false };
    }
    const mean = prior.reduce((a, b) => a + b, 0) / prior.length;
    const variance = prior.reduce((a, b) => a + (b - mean) ** 2, 0) / prior.length;
    const std = Math.sqrt(variance);
    // guard a flat baseline (std≈0): only flag if the value genuinely moved
    const sigma = std > 1e-9 ? (current - mean) / std : (Math.abs(current - mean) > 1e-9 ? Infinity : 0);
    const finiteSigma = Number.isFinite(sigma) ? Number(sigma.toFixed(2)) : sigma;
    return {
      metric,
      samples: arr.length,
      mean: Number(mean.toFixed(4)),
      std: Number(std.toFixed(4)),
      current,
      sigma: finiteSigma,
      anomaly: Math.abs(sigma) >= ANOMALY_SIGMA,
    };
  }

  /** baselines for every tracked metric */
  all(): MetricBaseline[] {
    return Object.keys(this.series).map((m) => this.baseline(m)!).filter(Boolean);
  }

  /** the single most-anomalous metric right now (highest |σ| on a warm baseline) */
  topAnomaly(): MetricBaseline | null {
    const warm = this.all().filter((b) => b.sigma !== null);
    if (!warm.length) return null;
    return warm.reduce((top, b) => (Math.abs(b.sigma!) > Math.abs(top.sigma!) ? b : top));
  }

  clear(): void {
    for (const k of Object.keys(this.series)) delete this.series[k];
  }
}

export const BASELINE_CONST = { WINDOW, WARMUP, ANOMALY_SIGMA };
