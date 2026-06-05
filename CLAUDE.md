# WATCHDOG — Behavioral Intelligence Layer for Trading Agents
## Bitget AI Base Camp Hackathon S1 | Track 2: Trading Infra

---

## what this project is

WATCHDOG is a behavioral intelligence and safety layer for autonomous trading agents.

it does four things no other infra tool in this hackathon does:
1. assigns every agent a live **Trust Score (0–100)** that updates every trade
2. **predicts** behavioral breaches before they happen, not just after
3. when an agent fails, an LLM writes a plain-english **incident diagnosis**
4. runs a **public fleet leaderboard** — a verifiable reputation layer for agents

it wraps any Bitget trading agent in three lines of code. monitoring needs no API credentials. it is the thing every other agent in this hackathon should run behind.

---

## the one-line pitch

"every agent gets a credit score for its behavior — live, predictive, explainable, public, and provably tested."

## the stat that opens the pitch

40% of enterprise AI projects are cancelled because agents fail unpredictably. WATCHDOG is the layer that catches the failure before it cancels the project.

---

## why this matters (the real problem)

in 2026, autonomous trading agents caused over $45M in losses — not from hacks, but from agents replicating the worst human trading habits:
- one major LLM agent made 238 trades in 17 days — destroying capital on fees (overtrading)
- another suffered analysis paralysis — hesitating on winning signals
- another chased social hype into bad positions

builders monitor P&L. nobody monitors whether the agent is *behaving sanely*. and crucially: there is no way to compare agents on behavior, no shared reputation, no early warning. WATCHDOG is that missing layer.

this is the Track 2 winner thesis: it's not a safety checkbox, it's the behavioral trust infrastructure the whole agent ecosystem is missing.

---

## hackathon context (verified)

- **event:** Bitget AI Base Camp Hackathon S1
- **track:** Track 2 — Trading Infra (for engineers)
- **registration deadline:** June 9, 2026 (24:00 UTC+8)
- **submission window:** June 10 – June 25, 2026 (24:00 UTC+8)
- **judging:** June 25–29 | **results:** June 30
- **prizes:** 1st 6,600 USDT · 2nd 1,500 (per track) · 3rd 800 (per track) · best spread 500 ×3
- **social bonus:** +10 USDT per qualifying post with #BitgetHackathon @ Bitget AI (first 500)

### Track 2 submission requirements (mandatory)
1. GitHub repo — runnable, complete README, usage docs, sensible API so others integrate cheaply
2. demo video ≤3 min — core features + how other agents integrate
3. project description ≤200 words — problem, approach, extensibility, Bitget modules used

### Track 2 judging priorities (verified)
- product power first — can others integrate easily, low setup cost
- solves a real agent-dev pain, not a reproduction of existing features
- complete README, reasonable API, strong extensibility

---

## the five behavioral metrics (the foundation)

```
1. TRADE FREQUENCY      — trades/hour. catches overtrading (the 238-trades case)
2. POSITION SIZE DRIFT  — size creep as % of portfolio. catches risk escalation
3. DRAWDOWN VELOCITY    — how fast equity is dropping. catches bleeding out
4. CONSECUTIVE LOSSES   — losses in a row. catches a broken strategy in this regime
5. SIGNAL OVERRIDE RATE — acting against own stated signals. catches erratic tilt
```
each returns `ok | warning | violation` with value, threshold, detail.

---

## the four intelligence layers (what makes it win)

### LAYER 1 — TRUST SCORE (0–100)
a single composite score per agent, recomputed every trade.
- starts at 100, each metric deducts weighted points based on status
- frequency/drawdown weigh heaviest (most destructive failure modes)
- exponential moving average so the score has a smooth trend, not jitter
- bands: 80–100 healthy (green) · 50–79 caution (amber) · 0–49 unsafe (red)
- this is the number judges remember. expose it prominently everywhere.

### LAYER 2 — PREDICTIVE EARLY WARNING
watches the *trajectory* of each metric, not just current value.
- linear regression on the last N samples of each metric
- projects forward: "at current velocity, drawdown breaches limit in ~6 trades"
- fires a `forecast` warning before an actual violation
- this is what turns a kill switch into a co-pilot

### LAYER 3 — AI DIAGNOSIS (Bitget Skill Hub earns its place here)
when status hits violation OR trust score drops sharply, generate an incident report.
- gather: recent event history + the five metric states + live market context
- market context pulled from Bitget Agent Hub public data (funding rate, volatility) via bgc
- send to an LLM with a structured prompt → returns a plain-english post-mortem:
  "agent opened 14 longs in 8 minutes during low-volatility chop. matches a tilt
   pattern — reacting to noise as signal. recommend cooldown + threshold review."
- store the report, surface it on the dashboard and via API
- this is the moment no other infra tool will have

### LAYER 4 — FLEET LEADERBOARD (the real differentiator)
monitor many agents at once, rank them by trust score over time.
- each agent has a profile: current trust, trend, total trades, regimes survived, incidents
- public leaderboard endpoint + dashboard view
- this makes agent track records *verifiable and comparable* — a reputation layer
- the infra story: agents could carry a WATCHDOG trust badge like a site carries SSL

---

## the five proof features (what turns "strong" into "winning")

researched from 2026 hackathon winners. the pattern: winners ship a *product* with a *verifiable number*, not a demo. an Anthropic judge's highest praise was literally "this feels like a product, not a hackathon project." these five deliver that.

### PROOF 1 — CHAOS HARNESS (absorbs the chaos-agent, becomes the benchmark engine)
a library of ~10 deterministic misbehavior scenarios that WATCHDOG is proven to catch:
- overtrader (238-trades pattern), panic-seller, drift-creeper, signal-flipper,
  drawdown-bleeder, revenge-trader, paralysis (never exits), hype-chaser,
  size-doubler, regime-blind (momentum strat in a ranging market)
- each scenario is a seeded, reproducible agent behavior — same input → same result every run
- `runChaosSuite()` runs all scenarios against WATCHDOG and records what was caught
- this is HEXFIRE's winning angle (deterministic fault injection) applied to trading safety
- it triples as: the benchmark, the test fixtures, and the demo

### PROOF 2 — VERIFIABLE BENCHMARK REPORT
the chaos harness outputs hard, reproducible numbers — the Kraken winner's "232/232 passed" move:
- detection rate (% of misbehaviors caught)
- false-positive rate (% of healthy behavior wrongly flagged)
- mean time-to-detection (avg trades/seconds until catch)
- target headline: "caught 10/10 misbehavior classes, 0 false positives on the well-behaved agent, mean detection 1.4 trades"
- `npm run benchmark` regenerates the table; it lives at the top of the README; judges reproduce it by cloning

### PROOF 3 — TEST COVERAGE AS A HEADLINE
- full unit coverage on all five metrics + all four intelligence layers
- a coverage badge at the very top of the README
- target: "187/187 tests passed" stated as a feature, not an afterthought
- this is what makes judges read it as production-grade

### PROOF 4 — READ-ONLY AUDIT TRAIL (tamper-evident)
- every decision, metric evaluation, trust change, and incident hash-chained (each entry includes the hash of the previous → tamper-evident)
- exportable as JSON; exposed via a public read-only endpoint exactly like the Kraken judges received
- `getAuditTrail()` returns the chain; `verifyAuditChain()` confirms integrity
- "no black boxes" — every decision is verifiable after the fact

### PROOF 5 — TRUST BADGE AS A SERVICE
- a tiny endpoint `/badge/:agentId` that renders a live SVG trust badge (like a CI badge)
- any agent's README can embed its WATCHDOG trust score: `![trust](watchdog.../badge/my-agent)`
- makes the reputation-layer story tangible — this is the viral, infra-defining hook
- small build, outsized narrative payoff

---

## the integration contract (the product surface)

```typescript
import { Watchdog } from 'watchdog-agent'

const watchdog = new Watchdog({
  agentId: 'my-trading-agent',
  portfolioUsdt: 10000,
  rules: {
    maxTradesPerHour: 10,
    maxPositionSizePercent: 25,
    maxDrawdownPercent: 15,
    maxConsecutiveLosses: 4,
    maxSignalOverridesPerHour: 3
  },
  onViolation: 'pause',          // 'pause' | 'alert' | 'log'
  ai: { enabled: true },         // LAYER 3 diagnosis
  fleet: { register: true }      // LAYER 4 leaderboard
})

// before every trade:
const decision = await watchdog.checkTrade({
  type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long'
})
if (decision.approved) { /* execute via Bitget */ }
else { console.log('blocked:', decision.reason, 'trust:', decision.trustScore) }

// report outcomes:
watchdog.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -12 })
watchdog.reportSignal({ signal: 'bearish', action: 'open-long' })

// read intelligence:
watchdog.getTrustScore()      // → { score, band, trend }
watchdog.getForecast()        // → predictive warnings
watchdog.getLastDiagnosis()   // → latest AI incident report
watchdog.getAuditTrail()      // → hash-chained decision log
watchdog.verifyAuditChain()   // → { valid, brokenAt }
Watchdog.getLeaderboard()     // → static: all registered agents ranked
Watchdog.renderBadge(agentId) // → static: SVG trust badge string
```

three lines to wrap, one call per trade. low integration cost is the Track 2 bar.

---

## tech stack

- Node.js + TypeScript, published as npm package `watchdog-agent`
- Bitget integration: `bitget-client` CLI (`bgc`) + MCP server
- market context: Bitget Agent Hub public data (no credentials needed)
- AI diagnosis: LLM via API (MuleRun-subsidized model, or Claude)
- dashboard: HTML + vanilla JS, dark theme
- storage: in-memory ring buffer + lightweight JSON for fleet/leaderboard demo
- deploy: Vercel (dashboard + API), npm (package)

---

## folder structure

```
watchdog-agent/
├── CLAUDE.md
├── PHASE_0_CHECKLIST.md
├── BUILD_GUIDE.md
├── README.md                  ← most important file for Track 2
├── package.json
├── tsconfig.json
├── .env.example
├── src/
│   ├── index.ts               ← Watchdog class + exports (public API frozen)
│   ├── metrics/
│   │   ├── frequency.ts
│   │   ├── positionDrift.ts
│   │   ├── drawdown.ts
│   │   ├── lossStreak.ts
│   │   └── signalOverride.ts
│   ├── intelligence/
│   │   ├── trustScore.ts      ← LAYER 1
│   │   ├── forecast.ts        ← LAYER 2
│   │   ├── diagnosis.ts       ← LAYER 3 (LLM + bgc market context)
│   │   ├── fleet.ts           ← LAYER 4 leaderboard registry
│   │   └── audit.ts           ← PROOF 4 hash-chained audit trail
│   ├── engine/
│   │   ├── rules.ts
│   │   └── actions.ts
│   ├── store/
│   │   └── buffer.ts
│   ├── market/
│   │   └── context.ts         ← bgc public-data wrapper for diagnosis
│   ├── badge/
│   │   └── render.ts          ← PROOF 5 SVG trust badge
│   └── server/
│       └── dashboard.ts
├── chaos/
│   ├── scenarios.ts           ← PROOF 1 the 10 misbehavior scenarios
│   ├── harness.ts             ← runChaosSuite() runner
│   └── benchmark.ts           ← PROOF 2 generates the benchmark table
├── public/
│   ├── index.html             ← single-agent live dashboard
│   └── leaderboard.html       ← fleet leaderboard view
├── examples/
│   ├── demo-agent.ts          ← well-behaved
│   ├── chaos-agent.ts         ← live demo (pulls one scenario from chaos/)
│   └── fleet-demo.ts          ← several agents at once → leaderboard
├── BENCHMARK.md               ← PROOF 2 the reproducible results table
└── test/
    └── *.test.ts              ← PROOF 3 full coverage, headline number
```

---

## environment variables

```bash
BITGET_API_KEY=                # only if demo agent trades live; monitoring needs none
BITGET_SECRET_KEY=
BITGET_PASSPHRASE=
WATCHDOG_AI_API_KEY=           # for LAYER 3 diagnosis LLM calls
WATCHDOG_AI_MODEL=             # model name (MuleRun-subsidized or Claude)
WATCHDOG_PORT=3000
```

---

## Bitget Agent Hub setup (verified commands)

```bash
npm install -g bitget-client
# public market data — NO credentials needed (used by LAYER 3 context)
bgc spot spot_get_ticker --symbol BTCUSDT
bgc futures futures_get_funding_rate --productType USDT-FUTURES --symbol BTCUSDT
# the --read-only flag restricts bgc to read/query tools only — use this in WATCHDOG's
# monitoring path so the monitor can NEVER place an order. --pretty for readable JSON.
bgc --read-only account get_account_assets
# optional MCP for Claude Code
claude mcp add -s user --env BITGET_API_KEY=$BITGET_API_KEY --env BITGET_SECRET_KEY=$BITGET_SECRET_KEY --env BITGET_PASSPHRASE=$BITGET_PASSPHRASE bitget -- npx -y bitget-mcp-server
# optional: install everything + 5 analysis skills to Claude Code
npx bitget-hub upgrade-all --target claude
```

bgc modules available: spot, futures, account, margin, copytrading, convert, earn, p2p, broker. WATCHDOG's market-context wrapper uses spot + futures (public). the `copytrading` module is notable — behavioral monitoring of copy-trading agents is a natural extension.

### integration paths WATCHDOG supports (the product surface)
1. **library** — `import { Watchdog }`, wrap any agent in three lines (primary)
2. **MCP** — agents trading via the Bitget MCP server call checkTrade before each tool-use
3. **CLI / shell agents** — agents driven by `bgc` (Claude Code skills, OpenClaw) call the WATCHDOG CLI check
4. **OpenClaw webhook** — Agent Hub supports webhook-triggered automation via `bgc` in action scripts; WATCHDOG can expose a webhook endpoint that runs a trust check on trigger and returns approve/block. note this as an extensibility path in the README.

### the --read-only safety primitive (use it, mention it)
WATCHDOG's own market-context calls always use `bgc --read-only`. the monitor physically cannot place or cancel orders — it only observes. this is a clean safety story for the README: "the watchdog that guards your agent can never touch your funds."

---

## session prompts for Claude Code

**start:** "read CLAUDE.md and BUILD_GUIDE.md. we are on phase [X]. continue from where we left off. WATCHDOG is an npm package — the public API in CLAUDE.md is frozen, do not change it."

**stuck:** "stuck on [X]. re-read the relevant CLAUDE.md section. simplest fix that keeps the public API clean and integration cost low. don't over-engineer."

**commit:** "review this session against CLAUDE.md architecture. commit message: feat(phase-X): [what was built]"

**end:** "summarize done / remaining / next-start. update PHASE_0_CHECKLIST.md for completed items."

---

## git identity (before first commit)

```bash
git config user.name "Moren808"
git config user.email "your@email.com"
```

---

## demo video script (3 min)

1. 0:00–0:25 — problem. "40% of enterprise AI projects are cancelled because agents fail unpredictably." the 238-trades line. "builders watch P&L. nobody watches behavior."
2. 0:25–0:55 — integration. three lines to wrap an agent. checkTrade returns approval AND a trust score. effortless.
3. 0:55–1:45 — the chaos demo. run chaos-agent. trust score falls live, forecast fires early warning ("breach in ~5 trades"), violation, auto-pause. the instant it pauses, the AI diagnosis appears on screen — a written post-mortem.
4. 1:45–2:15 — the benchmark. run `npm run benchmark`. the harness fires all 10 misbehavior scenarios; the table prints: "10/10 caught, 0 false positives, mean detection 1.4 trades." reproducible by cloning. this is the verifiable-number moment that wins.
5. 2:15–2:40 — the leaderboard + badge. show the fleet leaderboard ranking agents by trust. then show a live trust badge embedded in a README. "a reputation layer for agents."
6. 2:40–3:00 — "WATCHDOG: a behavioral credit score for every agent. live, predictive, explainable, public, provably tested. 187/187 tests, MIT, three lines to integrate." show GitHub + npm + live URL.

---

## project description (under 200 words, ready to paste)

WATCHDOG is a behavioral intelligence layer for autonomous trading agents.

40% of enterprise AI projects are cancelled because agents fail unpredictably. In 2026, AI trading agents caused over $45M in losses — not from bad code, but bad behavior. One made 238 trades in 17 days, bleeding out on fees. Builders monitor profit and loss. Nobody monitors whether an agent is acting sanely, and nobody can compare agents on behavior at all.

WATCHDOG wraps any Bitget agent in three lines of code. It assigns a live Trust Score from 0 to 100. It predicts behavioral breaches before they happen. When an agent fails, it generates a plain-english incident diagnosis using an LLM plus live Bitget market context. It runs a public fleet leaderboard and renders embeddable trust badges — a verifiable reputation layer for agents.

Every claim is proven: a deterministic chaos harness fires 10 misbehavior classes and WATCHDOG catches them with a reproducible benchmark (detection rate, false positives, time-to-detection). Full test coverage. A tamper-evident, hash-chained audit trail. MIT licensed, no black boxes.

Monitoring needs no credentials — it uses Bitget Agent Hub public data via bgc. Three lines to integrate, fully extensible.
