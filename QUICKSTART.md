# WATCHDOG — Quickstart

Wrap any Bitget trading agent in three lines and get a live behavioral trust
score, predictive breach warnings, AI incident reports, and a public
leaderboard. **No API keys needed for monitoring.**

---

## 1. Install

```bash
npm install watchdog-agent
```

The core library has **zero runtime dependencies** (it only uses Node built-ins).

---

## 2. Wrap your agent

```typescript
import { Watchdog } from 'watchdog-agent';

const watchdog = new Watchdog({
  agentId: 'my-trading-agent',
  portfolioUsdt: 10_000,
  rules: {
    maxTradesPerHour: 10,          // overtrading guard
    maxPositionSizePercent: 25,    // size-creep guard
    maxDrawdownPercent: 15,        // bleed-out guard
    maxConsecutiveLosses: 4,       // broken-strategy guard
    maxSignalOverridesPerHour: 3,  // tilt guard
  },
  onViolation: 'pause',            // 'pause' | 'alert' | 'log'
  ai: { enabled: true },           // AI incident diagnosis
  fleet: { register: true },       // public leaderboard
});
```

Pick rules that mean "sane" for *your* strategy.

---

## 3. Gate every trade

One call before you place an order, two after you learn the outcome:

```typescript
// BEFORE placing an order — ask permission
const decision = await watchdog.checkTrade({
  type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long',
});

if (decision.approved) {
  await bitget.placeOrder(/* ...your existing Bitget call... */);
} else {
  console.log('WATCHDOG blocked it:', decision.reason);
  // e.g. "frequency: 11 trades in last hour exceeds limit of 10"
}

// AFTER the position closes — report the outcome
watchdog.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -12 });

// (optional) tell WATCHDOG what your signal said, so it can catch tilt
watchdog.reportSignal({ signal: 'bearish', action: 'open-long' });
```

That's the whole integration. Your agent keeps working exactly as before —
WATCHDOG just gets a veto and a record.

---

## 4. Read the intelligence

Anytime, from code:

```typescript
watchdog.getTrustScore();     // → { score: 76, band: 'caution', trend: 'down' }
watchdog.getForecast();       // → "drawdown will breach in ~3 trades"
watchdog.getLastDiagnosis();  // → AI postmortem when something broke (or null)
watchdog.getAuditTrail();     // → hash-chained, tamper-evident decision log
watchdog.verifyAuditChain();  // → { valid, brokenAt }

Watchdog.getLeaderboard();    // → all registered agents, ranked by trust
Watchdog.renderBadge('my-trading-agent'); // → live SVG trust badge
```

---

## 5. (Optional) Live dashboard

```typescript
import { createDashboardServer } from 'watchdog-agent/server';

await createDashboardServer(watchdog, 3000);
// open http://localhost:3000
```

The dashboard subpath needs the optional `express` dependency:

```bash
npm install express
```

You get three live pages:

- **`/`** — single-agent monitor: trust gauge, 5 metric bars, forecast strip,
  pause banner, AI incident report, activity feed
- **`/leaderboard.html`** — the fleet reputation board
- **`/ledger.html`** — reconstructed trade history + running equity

---

## What the "aha" moment looks like

Your scalper has a bug and starts firing trades in a loop.

**Without WATCHDOG:** it burns $1,200 in fees over a weekend; you find out Monday.

**With WATCHDOG**, on the 11th rapid trade:

1. `checkTrade` returns `approved: false` — the bad trade **never executes**
2. The agent auto-pauses
3. An AI incident report appears:
   *"Agent fired 11 identical orders in 1.5 seconds — runaway loop, not a
   strategy. Recommend: audit the order-submission loop for a missing exit
   condition."*
4. The agent's trust score drops on the public leaderboard

Fix the bug, call `watchdog.reset()`, resume.

---

## Enable AI diagnosis (optional)

Set these in your environment (or a `.env` file):

```bash
WATCHDOG_AI_API_KEY=sk-ant-...     # your Anthropic key
WATCHDOG_AI_MODEL=claude-sonnet-4-6
```

Without a key, WATCHDOG still generates a **templated** diagnosis from the
metric state — so a demo never breaks. With a key, you get the rich
plain-English LLM report (with live Bitget market context).

---

## Run the bundled demos

```bash
git clone https://github.com/neromtoobad/watchdog-agent.git
cd watchdog-agent && npm install

npm test                  # 165 tests
npm run benchmark         # the chaos benchmark → BENCHMARK.md
npm run demo:chaos        # THE demo: trust falls → pause → AI diagnosis → recovery
npm run demo:fleet        # 5 agents → live leaderboard
npx ts-node examples/wrap-your-agent.ts   # the copy-paste starter
```

Full API reference + architecture in the [README](README.md).
