# BUILD GUIDE — WATCHDOG v2
## phase-by-phase build

---

## overview

| Phase | What gets built | Est. time |
|-------|----------------|-----------|
| 0 | Setup + API lock + AI smoke test | 1 day |
| 1 | Core class + event ring buffer | 1.5 days |
| 2 | The five behavioral metrics | 2.5 days |
| 3 | Rule engine + actions (pause/alert/log) | 1 day |
| 4 | LAYER 1 trust score | 1 day |
| 5 | LAYER 2 predictive forecast | 1 day |
| 6 | LAYER 3 AI diagnosis (+ bgc market context) | 1.5 days |
| 7 | LAYER 4 fleet leaderboard | 1 day |
| 8 | PROOF 4 audit trail + PROOF 5 trust badge | 1 day |
| 9 | PROOF 1 chaos harness + PROOF 2 benchmark | 1.5 days |
| 10 | Dashboards (single + leaderboard) | 2 days |
| 11 | Demo agents (good, chaos, fleet) | 1 day |
| 12 | PROOF 3 full test coverage pass | 1 day |
| 13 | npm publish + Vercel deploy | 1 day |
| 14 | README + BENCHMARK.md + video + submission | 2 days |

~20 working days of content; ~21 days to deadline. tight. cut order if needed: prediction (L2) most cuttable, then dashboard polish. NEVER cut: chaos harness + benchmark (the verifiable number), trust score, AI diagnosis, leaderboard, the headline test count. those are the win.

priority spine: phases 1-3 (foundation) → 4,6,7 (differentiators) → 8,9 (proof features that win) → 10,11 (what judges see) → 12 (the test headline) → 14 (README + benchmark, where Track 2 is won).

---

## phase 1 — core class + event store
- `src/store/buffer.ts`: generic RingBuffer<T> (push, getAll, getWindow(ms, now), clear), size 1000
- `src/index.ts`: Watchdog class with FROZEN public API from CLAUDE.md. for now checkTrade always approves and records; intelligence getters return empty. wire config (agentId, portfolioUsdt, rules, onViolation, ai, fleet).
- done when: instantiate, checkTrade, reportTradeClosed, reportSignal all record to buffer; `npx tsc --noEmit` passes.

## phase 2 — the five metrics
each a pure fn `(events, rules, now) => MetricResult { name, status, value, threshold, detail }`.
- frequency.ts — trades/hour vs maxTradesPerHour (ok<70%, warning 70-100%, violation>100%)
- lossStreak.ts — consecutive negative closes vs maxConsecutiveLosses
- drawdown.ts — cumulative equity from closes → drawdown % from peak vs maxDrawdownPercent
- positionDrift.ts — recent avg sizeUsdt as % of portfolioUsdt vs maxPositionSizePercent
- signalOverride.ts — signal-vs-action conflicts in last hour vs maxSignalOverridesPerHour
- done when: vitest unit tests prove ok/warning/violation transitions for all five.

## phase 3 — rule engine + actions
- engine/rules.ts: evaluateAll → WatchdogStatus { overall: worst-of-five, metrics[], violations[], timestamp }
- engine/actions.ts: handleViolation(mode, status, setPaused) → log (warn, no block) / alert (warn + emit, no block) / pause (setPaused, block)
- wire into checkTrade: evaluate → if violation and mode pause, block and return approved:false with reason; if already paused, block immediately; reset() clears.
- done when: well-behaved sequence approved; tight loop trips frequency and starts blocking.

## phase 4 — LAYER 1 trust score
- intelligence/trustScore.ts: computeTrust(status, prevScore) → { score 0-100, band, trend }
  - start 100; deduct weighted points per metric by status (frequency + drawdown heaviest)
  - EMA against prevScore for smooth trend; band thresholds 80 / 50
- Watchdog recomputes trust on every checkTrade and reportTradeClosed; getTrustScore() returns it; include trustScore in every TradeDecision.
- done when: trust visibly falls as chaos agent misbehaves, recovers as good agent behaves.

## phase 5 — LAYER 2 predictive forecast
- intelligence/forecast.ts: for each metric keep a short history; linear-regress recent samples; project trades-until-breach; return forecast warnings when projected breach is near.
- getForecast() exposes it; checkTrade attaches forecasts to the decision.
- done when: before an actual drawdown/frequency violation, a forecast warning fires with an ETA.

## phase 6 — LAYER 3 AI diagnosis
- market/context.ts: wrap bgc public data (funding rate, recent volatility) using `bgc --read-only` so the monitor can never place orders — no credentials needed for public data
- intelligence/diagnosis.ts: on violation OR sharp trust drop, build a structured prompt {recent events, five metric states, market context}, call the LLM (WATCHDOG_AI_API_KEY/MODEL), return a plain-english report {summary, likelyCause, recommendation}. cache the latest.
- getLastDiagnosis() exposes it. fail gracefully if AI is down (return a templated fallback so the demo never breaks).
- done when: the instant chaos-agent is paused, a written post-mortem is available and shows real market context.

## phase 7 — LAYER 4 fleet leaderboard
- intelligence/fleet.ts: a module-level registry of agents that opt in via fleet.register. each profile: agentId, current trust, trend, totalTrades, regimesSurvived (count distinct market regimes seen), incidents (count). 
- static Watchdog.getLeaderboard() returns all profiles sorted by trust desc.
- persist to a JSON file for the demo so the leaderboard survives restarts.
- done when: running several Watchdog instances registers them and getLeaderboard ranks them.

## phase 8 — PROOF 4 audit trail + PROOF 5 trust badge
- intelligence/audit.ts: every decision/metric-eval/trust-change/incident appended to a hash chain — each entry stores hash(prevHash + entryData). expose getAuditTrail() (full chain) and verifyAuditChain() ({valid, brokenAt}). wire Watchdog to append on every checkTrade and trust recompute.
- badge/render.ts: renderBadge(agentId) returns an SVG string — a CI-style badge showing the agent's trust score, colored by band (green/amber/red). static Watchdog.renderBadge(agentId) reads from the fleet registry.
- done when: audit chain verifies as valid, tampering breaks it at the right index, and renderBadge returns valid SVG that shows the live score.

## phase 9 — PROOF 1 chaos harness + PROOF 2 benchmark
- chaos/scenarios.ts: define ~10 deterministic misbehavior scenarios as seeded functions, each producing a fixed sequence of trades/closes/signals: overtrader, panic-seller, drift-creeper, signal-flipper, drawdown-bleeder, revenge-trader, paralysis, hype-chaser, size-doubler, regime-blind. each scenario declares which metric(s) it SHOULD trip.
- chaos/harness.ts: runChaosSuite() runs every scenario against a fresh Watchdog, records whether the expected violation fired, at which trade, and whether the well-behaved control produced any false positive. returns a structured result.
- chaos/benchmark.ts: formats the harness output into a table — detection rate, false-positive rate, mean time-to-detection — and writes BENCHMARK.md. add npm script "benchmark": "ts-node chaos/benchmark.ts".
- done when: `npm run benchmark` prints and writes the table with target numbers (10/10 caught, 0 false positives, low mean detection). this is reproducible by anyone who clones.

## phase 10 — dashboards
- server/dashboard.ts: express, endpoints GET /api/status (single agent full status + trust + forecast + lastDiagnosis), /api/events, /api/leaderboard, /api/audit (read-only audit trail), /badge/:agentId (SVG, content-type image/svg+xml), /api/health. serve public/.
- public/index.html: dark theme. top: agentId + big Trust Score dial (0-100, colored by band) + trend arrow. row of five metric cards. a forecast strip ("breach in ~N trades"). a pause banner on violation. when a diagnosis exists, render it in an "incident report" card. live event log. poll every 2s.
- public/leaderboard.html: table of agents ranked by trust — agentId, trust score (colored), trend, trades, regimes survived, incidents. poll /api/leaderboard.
- done when: single dashboard shows trust dial + forecast + diagnosis reacting live; leaderboard ranks the fleet; /badge/:agentId renders an SVG; /api/audit returns the chain.

## phase 11 — demo agents
- examples/demo-agent.ts: well-behaved, trust stays green — the happy path.
- examples/chaos-agent.ts: THE moment. pulls the overtrader scenario from chaos/scenarios.ts; narrate "trade 8 approved → trade 11 forecast: breach soon → trade 14 BLOCKED, paused"; on pause, print the AI diagnosis. then reset() to show recovery.
- examples/fleet-demo.ts: spin up 4-5 agents using different chaos scenarios, all registered to the fleet, so the leaderboard populates and visibly ranks them.
- done when: chaos-agent produces a dramatic pause + written diagnosis; fleet-demo fills the leaderboard.

## phase 12 — PROOF 3 full test coverage pass
- ensure every metric and every intelligence layer (trust, forecast, diagnosis fallback, fleet, audit) has unit tests. add tests for the chaos scenarios themselves (each trips its declared metric).
- run with coverage; aim for full coverage on src/metrics and src/intelligence.
- capture the final passing count (e.g. "187/187") — this becomes a README headline and a video line.
- done when: `npx vitest run --coverage` is green with high coverage and you have the headline number.

## phase 13 — publish + deploy
- npm: finalize package.json (main dist/index.js, types dist/index.d.ts, files [dist]); `npx tsc`; `npm pack --dry-run` to confirm contents; then `npm publish --access public`. smoke test in a clean folder.
- Vercel: api/ serverless functions (status, events, leaderboard, audit, health) + /badge/:agentId. serverless is stateless → drive the live demo from a recorded chaos run + a static leaderboard JSON so visitors always see trust falling, a diagnosis, and rankings on a loop. the badge endpoint reads the static leaderboard JSON. serve public/ as static. push to GitHub, connect Vercel, set env vars, deploy.
- done when: `npm install watchdog-agent` works from clean; dashboard + leaderboard live; /badge/:agentId renders a live SVG anyone can embed.

## phase 14 — README + BENCHMARK + video + submission (Track 2 won here)
README structure:
```
# WATCHDOG — Behavioral Intelligence Layer for Trading Agents
> a behavioral credit score for every agent — live, predictive, explainable, public, provably tested.
[coverage badge] [npm version] [MIT license]
## the benchmark (LEAD with the reproducible table — detection rate, false positives, time-to-detection. "10/10 caught, 0 false positives." reproduce with npm run benchmark)
## the problem (the 40% / $45M / 238-trades story, 3 sentences)
## install — npm install watchdog-agent
## quick start — LEAD with the three-line integration; show checkTrade returning trust score
## the trust score (how 0-100 is computed, bands)
## the five metrics (table: metric | catches | default threshold | why)
## predictive warnings (how forecast works)
## AI diagnosis (sample incident report; uses Bitget public market context)
## fleet leaderboard + trust badge (reputation layer; show an embedded badge)
## the chaos harness (the 10 scenarios, how to run the suite)
## audit trail (hash-chained, verifiable, exportable)
## API reference (every public method, signature + example)
## custom rules & metrics (extensibility)
## how it uses Bitget Agent Hub (bgc public data for diagnosis; MCP for live agents; no creds to monitor; --read-only so the monitor can never trade)
## integration paths (library, MCP, CLI/shell agents, OpenClaw webhook)
## tests (the headline count — "187/187 passed")
## live demo (dashboard URL + leaderboard URL + badge URL)
## license MIT
```
README rule: a dev understands integration in <60s AND sees a verifiable number on the first screen. lead with the benchmark table and the three-line integration. this is the Track 2 score.

BENCHMARK.md: full reproducible methodology + results table, generated by `npm run benchmark`. linked from the README.

video: see CLAUDE.md beat-by-beat. must show integration → chaos pause → AI diagnosis → benchmark numbers → leaderboard + badge.

submission checklist:
- [ ] GitHub public, README complete with benchmark table + coverage badge, runs from clean clone
- [ ] npm package published + installable
- [ ] BENCHMARK.md present and reproducible via npm run benchmark
- [ ] demo video ≤3 min (integration + chaos + diagnosis + benchmark + leaderboard/badge)
- [ ] description ≤200 words (CLAUDE.md)
- [ ] dashboard URL + leaderboard URL + badge URL live
- [ ] X post with #BitgetHackathon @ Bitget AI, link saved
- [ ] submission form filled (June 10–25)

---

## stuck protocol
blocked >30 min: re-read the phase; ask Claude Code "simplest version that keeps the public API clean and still demos?"; simplify the internals, never the integration contract. AI diagnosis must fail gracefully to a template so the demo never breaks. never let dashboard polish block the four intelligence layers or the chaos demo.

Track 2 bar: product power, low integration cost, real pain solved, great README. a simple-to-adopt tool with a memorable trust score beats a complex one nobody integrates.
