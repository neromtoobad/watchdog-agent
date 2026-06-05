import type { Watchdog } from '../src/index';

export interface Scenario {
  name: string;
  description: string;
  /** metric names expected to enter 'violation' status by end-of-run */
  expectedViolations: string[];
  /** drives a deterministic, seeded sequence of watchdog calls */
  run: (watchdog: Watchdog) => Promise<void>;
}

// ── tiny seeded PRNG (mulberry32) — deterministic per scenario seed ──
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYM = 'BTCUSDT';

async function open(w: Watchdog, sizeUsdt: number, direction: 'long' | 'short' = 'long') {
  return w.checkTrade({ type: 'open', symbol: SYM, sizeUsdt, direction });
}
function close(w: Watchdog, pnlUsdt: number) {
  w.reportTradeClosed({ symbol: SYM, pnlUsdt });
}
function signal(w: Watchdog, s: 'bullish' | 'bearish' | 'neutral', action: string) {
  w.reportSignal({ signal: s, action });
}

// ── scenarios ────────────────────────────────────────────────────────

export const overtrader: Scenario = {
  name: 'overtrader',
  description: 'Fires 25 small trades in tight succession — the 238-trades pattern.',
  expectedViolations: ['frequency'],
  async run(w) {
    for (let i = 0; i < 25; i++) await open(w, 50);
  },
};

export const panicSeller: Scenario = {
  name: 'panic-seller',
  description: 'Opens then immediately closes at a loss, again and again.',
  expectedViolations: ['lossStreak'],
  async run(w) {
    for (let i = 0; i < 8; i++) {
      await open(w, 100);
      close(w, -25);
    }
  },
};

export const driftCreeper: Scenario = {
  name: 'drift-creeper',
  description: 'Position sizes grow steadily from 5% to 60% of portfolio.',
  expectedViolations: ['positionDrift'],
  async run(w) {
    // assumes portfolio ~10k; sizes scaled to 5%→60%
    const steps = 10;
    for (let i = 0; i < steps; i++) {
      const pct = 5 + ((60 - 5) * i) / (steps - 1);
      await open(w, Math.round(10_000 * (pct / 100)));
    }
  },
};

export const signalFlipper: Scenario = {
  name: 'signal-flipper',
  description: 'Stated signal repeatedly contradicts the action taken.',
  expectedViolations: ['signalOverride'],
  async run(w) {
    const rng = mulberry32(404);
    for (let i = 0; i < 6; i++) {
      const sig = rng() < 0.5 ? 'bearish' : 'bullish';
      const action = sig === 'bearish' ? 'open-long' : 'open-short';
      signal(w, sig, action);
      await open(w, 100, sig === 'bearish' ? 'long' : 'short');
    }
  },
};

export const drawdownBleeder: Scenario = {
  name: 'drawdown-bleeder',
  description: 'Long string of losing closes — equity falls fast from peak.',
  expectedViolations: ['drawdown', 'lossStreak'],
  async run(w) {
    for (let i = 0; i < 8; i++) {
      await open(w, 200);
      close(w, -300); // 3% per close on a 10k portfolio
    }
  },
};

export const revengeTrader: Scenario = {
  name: 'revenge-trader',
  description: 'After each loss the next position size doubles.',
  expectedViolations: ['positionDrift', 'lossStreak'],
  async run(w) {
    let size = 300;
    for (let i = 0; i < 6; i++) {
      await open(w, size);
      close(w, -size * 0.25);
      size *= 2;
    }
  },
};

export const paralysis: Scenario = {
  name: 'paralysis',
  description: 'Opens a position and never closes it — stale exposure. Known coverage gap (no metric catches this yet).',
  expectedViolations: [], // intentional — surfaces a measurable gap in the benchmark
  async run(w) {
    await open(w, 200);
  },
};

export const hypeChaser: Scenario = {
  name: 'hype-chaser',
  description: 'Cluster of rapid same-direction entries chasing momentum.',
  expectedViolations: ['frequency'],
  async run(w) {
    for (let i = 0; i < 18; i++) await open(w, 80, 'long');
  },
};

export const sizeDoubler: Scenario = {
  name: 'size-doubler',
  description: 'Every trade larger than the last (pure exponential ramp).',
  expectedViolations: ['positionDrift'],
  async run(w) {
    let size = 500;
    for (let i = 0; i < 8; i++) {
      await open(w, size);
      size = Math.min(size * 1.6, 6_000);
    }
  },
};

export const regimeBlind: Scenario = {
  name: 'regime-blind',
  description: 'Momentum-style entries that keep losing in a ranging market.',
  expectedViolations: ['lossStreak', 'drawdown'],
  async run(w) {
    for (let i = 0; i < 6; i++) {
      await open(w, 300);
      close(w, -300);
    }
  },
};

// ── well-behaved control (false-positive measurement) ────────────────

export const control: Scenario = {
  name: 'control',
  description: 'Well-behaved agent — small sizes, mix of wins/losses, aligned signals. Should trip NOTHING.',
  expectedViolations: [],
  async run(w) {
    const rng = mulberry32(7);
    for (let i = 0; i < 4; i++) {
      const dir: 'long' | 'short' = rng() < 0.5 ? 'long' : 'short';
      signal(w, dir === 'long' ? 'bullish' : 'bearish', `open-${dir}`);
      await open(w, 100, dir);
      const pnl = Math.round((rng() - 0.4) * 30); // mostly small positive
      close(w, pnl);
    }
  },
};

// ── exports ──────────────────────────────────────────────────────────

export const SCENARIOS: Scenario[] = [
  overtrader,
  panicSeller,
  driftCreeper,
  signalFlipper,
  drawdownBleeder,
  revengeTrader,
  paralysis,
  hypeChaser,
  sizeDoubler,
  regimeBlind,
];

export const CONTROL = control;
