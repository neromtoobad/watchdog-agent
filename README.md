<p align="center">
  <img src="public/assets/logo-512.png" alt="WATCHDOG" width="360" />
</p>

<h1 align="center">WATCHDOG</h1>

<p align="center">
  <b>Behavioral intelligence layer for autonomous trading agents.</b><br/>
  The credit score every Bitget agent should run behind.
</p>

<p align="center">
  <a href="#tests"><img src="https://img.shields.io/badge/tests-165%2F165%20passing-3fb950" alt="tests"/></a>
  <a href="#tests"><img src="https://img.shields.io/badge/coverage-92%25-3fb950" alt="coverage"/></a>
  <a href="BENCHMARK.md"><img src="https://img.shields.io/badge/chaos%20benchmark-10%2F10%20caught%20·%200%25%20FP-3fb950" alt="benchmark"/></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-3fb950" alt="license"/></a>
</p>

---

> Backtesters tell you if a strategy works on paper.
> **WATCHDOG tells you if the agent running it is behaving sanely — live, predictively, and in plain English.**

---

## Why this exists

In 2026, autonomous AI trading agents lost over $45M — not from hacks, but from agents replicating the worst human trading habits:

- one LLM agent made **238 trades in 17 days** — destroyed capital on fees alone
- another suffered analysis paralysis — froze on winning signals for hours
- another chased social hype into a $1.2M revenge-trade spiral

Builders monitor P&L. **Nobody monitors whether the agent is acting sanely.** And there is no shared way to compare agents on behavior — no reputation layer, no early warning, no postmortem when one fails.

WATCHDOG is that missing layer. Three lines to integrate, no API keys required for monitoring.

---

## What it looks like

| Live chaos demo — agent paused, AI diagnosis on screen | Fleet leaderboard — 5 agents, varied failure modes |
|---|---|
| ![dashboard](docs/screenshots/dashboard.png) | ![leaderboard](docs/screenshots/leaderboard.png) |

![ledger](docs/screenshots/ledger.png)

Three live views, all served by the same Express server:

- **`/`** — single-agent dashboard. Trust gauge centerpiece, 5 metric cards, forecast strip, pause banner, AI incident report, live event log.
- **`/leaderboard.html`** — fleet leaderboard. Every registered agent ranked by trust — *the public reputation layer*.
- **`/ledger.html`** — trade ledger. Reconstructs trades FIFO-per-symbol from the event stream, with running equity, win rate, profit factor — the "did this agent make money" view that sits next to "did this agent behave sanely."

---

## The headline numbers (reproducible)

```
$ npm run benchmark

caught 9/9 detectable misbehavior classes (100.0%)
false positives 0.0% on the well-behaved control
mean time-to-detection 8.44 input calls
```

See [BENCHMARK.md](BENCHMARK.md) for the full per-scenario table. The chaos harness is deterministic: same machine, same input → same table every run.

---

## Three lines to integrate

```typescript
import { Watchdog } from 'watchdog-agent';

const watchdog = new Watchdog({
  agentId: 'my-trading-agent',
  portfolioUsdt: 10_000,
  rules: {
    maxTradesPerHour: 10,
    maxPositionSizePercent: 25,
    maxDrawdownPercent: 15,
    maxConsecutiveLosses: 4,
    maxSignalOverridesPerHour: 3,
  },
  onViolation: 'pause',          // 'pause' | 'alert' | 'log'
  ai: { enabled: true },          // LLM incident diagnosis
  fleet: { register: true },      // public leaderboard
});

// before every trade:
const decision = await watchdog.checkTrade({
  type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long',
});
if (decision.approved) { /* execute via Bitget */ }
else { console.log('blocked:', decision.reason, 'trust:', decision.trustScore); }

// report outcomes:
watchdog.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -12 });
watchdog.reportSignal({ signal: 'bearish', action: 'open-long' });
```

That's it. Every trade is now scored. The dashboard, the AI diagnosis, the audit chain, the leaderboard entry — all populated automatically.

---

## The five behavioral metrics

Each evaluates to `ok | warning | violation` on every input.

| metric | what it catches | weight in trust score |
|---|---|---|
| `frequency` | overtrading — trades/hour vs `maxTradesPerHour` (the 238-trades case) | **30** |
| `drawdown` | bleeding equity — peak-to-current % vs `maxDrawdownPercent` | **30** |
| `positionDrift` | size creep — avg open sizeUsdt as % of portfolio | 15 |
| `lossStreak` | broken strategy in this regime — consecutive losing closes | 15 |
| `signalOverride` | tilt — agent acting against its own stated signals | 10 |

Frequency and drawdown carry the heaviest weight because they're the two most-destructive failure modes.

---

## The four intelligence layers

```
   raw events                          5 metric evaluators
   ──────────                          ───────────────────
   checkTrade()         ────►          frequency
   reportTradeClosed()  ────►          positionDrift
   reportSignal()       ────►          drawdown               worst-of
                                       lossStreak            ─────────►   RulesEvaluation
                                       signalOverride
                                              │
                                              ▼
   ┌─────────────────────────┬──────────────────────────┬─────────────────────────────┐
   │ Layer 1 — TRUST SCORE   │ Layer 2 — FORECAST       │ Layer 3 — AI DIAGNOSIS      │
   │ weighted EMA → 0..100   │ linear-regress recent    │ on new violation OR sharp   │
   │ bands at 80 / 50        │ samples, project breach  │ trust drop, call LLM with   │
   │ trend up/down/flat      │ within ~8 trades         │ events + metrics + live     │
   │                         │                          │ bgc market context →        │
   │                         │                          │ {summary, cause, fix}       │
   └─────────────────────────┴──────────────────────────┴─────────────────────────────┘
                                              │
                                              ▼
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │ Layer 4 — FLEET LEADERBOARD                                                       │
   │ every Watchdog with fleet.register=true appears in a sorted, persistent registry. │
   │ Watchdog.getLeaderboard() · GET /api/leaderboard · /leaderboard.html              │
   └──────────────────────────────────────────────────────────────────────────────────┘
```

Plus a hash-chained **audit trail** (`getAuditTrail()` + `verifyAuditChain()`) so every decision is tamper-evident, and an embeddable **SVG trust badge** (`Watchdog.renderBadge(agentId)` · `GET /badge/<agentId>`) so any agent's README can show its live score.

---

## Run it

```bash
git clone <this-repo>
cd watchdog-agent
npm install

# 1. unit + integration tests
npm test                                    # 155/155, ~1s

# 2. the chaos benchmark — writes BENCHMARK.md
npm run benchmark

# 3. the live dashboard demos (open http://localhost:3000)
WATCHDOG_PORT=3000 npx ts-node examples/demo-agent.ts        # well-behaved baseline
WATCHDOG_PORT=3000 npx ts-node examples/chaos-agent.ts       # THE demo — trust falls, agent pauses, AI diagnosis appears
WATCHDOG_PORT=3000 npx ts-node examples/fleet-demo.ts        # 5 agents, leaderboard re-ranks live
```

The AI diagnosis in `examples/chaos-agent.ts` calls Anthropic's Claude. Set `WATCHDOG_AI_API_KEY` + `WATCHDOG_AI_MODEL` in `.env` to enable. **It always works**: without an API key, a templated fallback diagnosis is generated from the metric state — the demo never breaks.

---

## How it fits with the Bitget ecosystem

WATCHDOG is the layer that runs **on top of any Bitget agent**:

- **Library** — wrap any Node/TypeScript agent in three lines
- **MCP** — agents calling Bitget via the MCP server invoke `checkTrade` before each tool-use
- **CLI / shell agents** — agents driven by `bgc` (Claude Code skills, OpenClaw) call the WATCHDOG CLI check
- **Playbook backtests** — pipe `signal_output[]` from a Bitget Playbook run through `replayPlaybookRun()` to get a combined **financial × behavioral** report ([`examples/playbook-watched.ts`](examples/playbook-watched.ts))

The monitor's own market-context fetcher uses `bgc --read-only` exclusively — WATCHDOG **physically cannot place or cancel orders**. The thing that guards your agent can never touch your funds.

```typescript
// Playbook adapter — turns a Bitget backtest into a combined report
const run = await runPlaybook({ versionId, accessKey });
const report = await replayPlaybookRun(run, watchdog);

// report.financial   → from Bitget: total_return_pct, sharpe, drawdown, win_rate
// report.behavioral  → from WATCHDOG: trust score, incidents, forecasts, AI diagnosis
```

Two strategies can both end at +5% PnL. The one that tilts hard mid-run has a low trust score and should not be deployed. **WATCHDOG is what tells you which is which.**

---

## What's in the box

```
src/
├── index.ts                    Watchdog class (frozen public API)
├── metrics/                    the 5 behavioral metrics
│   ├── frequency.ts            trades/hour vs limit
│   ├── positionDrift.ts        avg open size as % of portfolio
│   ├── drawdown.ts             peak-to-current equity %
│   ├── lossStreak.ts           consecutive losing closes
│   └── signalOverride.ts       signal-vs-action conflicts/hour
├── intelligence/
│   ├── trustScore.ts           Layer 1 — weighted EMA score
│   ├── forecast.ts             Layer 2 — linear-regression breach prediction
│   ├── diagnosis.ts            Layer 3 — LLM incident report + templated fallback
│   ├── fleet.ts                Layer 4 — persistent leaderboard registry
│   └── audit.ts                hash-chained tamper-evident decision log
├── engine/
│   ├── rules.ts                evaluateAll → RulesEvaluation
│   └── actions.ts              log / alert / pause handlers
├── market/context.ts           bgc --read-only wrapper (funding rate, volatility)
├── badge/render.ts             SVG trust badge
├── playbook/                   Bitget Playbook integration
│   ├── client.ts               /api/v1/playbook/run with retry/backoff
│   ├── adapter.ts              replayPlaybookRun → combined report
│   └── types.ts                Playbook control-plane response types
└── server/dashboard.ts         Express server — 6 endpoints + static UI

public/
├── index.html                  single-agent dashboard (trust gauge centerpiece)
└── leaderboard.html            fleet leaderboard view

chaos/
├── scenarios.ts                10 deterministic misbehavior scenarios + control
├── harness.ts                  runChaosSuite() — instrumented runner
└── benchmark.ts                writes BENCHMARK.md

examples/
├── demo-agent.ts               well-behaved baseline
├── chaos-agent.ts              THE demo — chaos → pause → AI diagnosis → recovery
├── fleet-demo.ts               5 concurrent agents → leaderboard re-ranks
└── playbook-watched.ts         pipe a Bitget Playbook backtest through WATCHDOG
```

---

## API surface

### Library

| call | returns | when |
|---|---|---|
| `new Watchdog(config)` | instance | once per agent |
| `await watchdog.checkTrade(req)` | `TradeDecision { approved, reason, trustScore, forecasts, action }` | before every order submission |
| `watchdog.reportTradeClosed(close)` | `void` | when a position closes |
| `watchdog.reportSignal(signal)` | `void` | when the agent emits a signal |
| `watchdog.getStatus()` | `WatchdogStatus` (5 metrics + trust + paused) | dashboard polling |
| `watchdog.getTrustScore()` | `{ score, band, trend }` | the headline number |
| `watchdog.getForecast()` | `Forecast[]` | predictive warnings |
| `watchdog.getLastDiagnosis()` | `Diagnosis \| null` | latest AI incident report |
| `watchdog.getAuditTrail()` | `AuditEntry[]` | tamper-evident decision log |
| `watchdog.verifyAuditChain()` | `{ valid, brokenAt }` | sanity check the audit chain |
| `watchdog.reset()` | `void` | clear paused + buffers |
| `Watchdog.getLeaderboard()` | `FleetProfile[]` | sorted by trust desc |
| `Watchdog.renderBadge(agentId)` | SVG string | trust badge per agent |

### HTTP endpoints (via `createDashboardServer(watchdog, port)`)

```
GET  /api/health                 { ok, uptime }
GET  /api/status                 { agentId, paused, status, trustScore, forecasts, lastDiagnosis }
GET  /api/events                 last-50 ring-buffer events
GET  /api/leaderboard            FleetProfile[]
GET  /api/audit                  { verified, brokenAt, trail[] }
GET  /api/ledger                 reconstructed trade ledger (FIFO per symbol) + summary stats
GET  /badge/:agentId             live SVG trust badge (content-type: image/svg+xml)
GET  /                           single-agent dashboard
GET  /leaderboard.html           fleet leaderboard
GET  /ledger.html                trade ledger view
```

---

## Tests

```
$ npm test

✓ test/audit.test.ts                       (8 tests)
✓ test/badge.test.ts                       (10 tests)
✓ test/buffer.test.ts                      (6 tests)
✓ test/diagnosis.test.ts                   (5 tests)
✓ test/drawdown.test.ts                    (7 tests)
✓ test/engine.test.ts                      (6 tests)
✓ test/fleet.test.ts                       (8 tests)
✓ test/forecast.test.ts                    (12 tests)
✓ test/frequency.test.ts                   (6 tests)
✓ test/ledger.test.ts                      (10 tests — FIFO trade reconstruction, equity walk, win rate, profit factor)
✓ test/lossStreak.test.ts                  (10 tests)
✓ test/playbook-adapter.test.ts            (7 tests)
✓ test/playbook-client.test.ts             (12 tests — retry + backoff)
✓ test/positionDrift.test.ts               (7 tests)
✓ test/scenarios-coverage.test.ts          (15 tests — every chaos scenario catches its declared expected violations)
✓ test/signalOverride.test.ts              (9 tests)
✓ test/trustScore.test.ts                  (10 tests)
✓ test/watchdog.test.ts                    (11 tests)
✓ test/watchdog-extras.test.ts             (6 tests)

Test Files  19 passed (19)
     Tests  165 passed (165)
  Duration  1.35s
```

```
$ npm run test:coverage

src/metrics              100% lines · 95% branches
src/engine               100% lines
src/store                100% lines
src/badge                100% lines
src/intelligence/audit   100% lines
src/intelligence/forecast 100% lines
src/intelligence/trustScore 100% lines
src/intelligence/fleet   95% lines
src/intelligence/diagnosis 83% lines
src/index.ts             92% lines
chaos/scenarios.ts       100% lines
chaos/harness.ts         75% lines (the CLI tail is exercised by `npm run benchmark`)

All files                92.48% lines, 89.5% branches
```

---

## Hackathon submission (Track 2 — Trading Infra · Bitget AI Base Camp S1)

**Problem.** 40% of enterprise AI projects are cancelled because agents fail unpredictably. In 2026, autonomous trading agents caused over $45M in losses — not from bad code, but bad behavior. Builders monitor profit and loss. Nobody monitors whether an agent is acting sanely, and nobody can compare agents on behavior at all.

**Solution.** WATCHDOG wraps any Bitget agent in three lines of code. It assigns a live Trust Score from 0 to 100, predicts behavioral breaches before they happen, generates a plain-English LLM incident diagnosis on violation (with live Bitget market context via `bgc --read-only`), and runs a public fleet leaderboard — a verifiable reputation layer for agents.

**Extensibility.** Library, MCP integration path, CLI/shell integration path, and a webhook surface (`POST /api/leaderboard` per agent). Drop-in for any agent that can call a function before placing a trade. Bitget modules used: `bgc spot`, `bgc futures` (read-only public data via Agent Hub), Playbook control-plane (`POST /api/v1/playbook/run` → `replayPlaybookRun()`).

**Proof.** Every claim is benchmarked: a deterministic chaos harness fires 10 misbehavior classes — overtrader, panic-seller, drift-creeper, signal-flipper, drawdown-bleeder, revenge-trader, paralysis, hype-chaser, size-doubler, regime-blind — and WATCHDOG catches them with a reproducible benchmark (100% detection, 0% false positives, 8.44 mean time-to-detection). 155/155 tests pass. A hash-chained audit trail makes every decision tamper-evident. MIT licensed, no black boxes.

---

## License

MIT. Use it. Ship it. Tell your friends.
