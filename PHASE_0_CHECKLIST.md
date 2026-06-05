# PHASE 0 CHECKLIST — WATCHDOG v2
## complete every item before writing core logic

---

## 1. accounts & access
- [ ] Bitget account verified
- [ ] Bitget API key created (Read is enough for the demo; Trade only if a demo agent places live orders)
- [ ] API key/secret/passphrase saved in `.env` (never committed)
- [ ] AI model access for LAYER 3 diagnosis — MuleRun-subsidized model key OR Claude API key in `.env` as WATCHDOG_AI_API_KEY
- [ ] Registered for hackathon (deadline June 9, 24:00 UTC+8)
- [ ] Joined Bitget AI Builders Telegram group
- [ ] MuleRun Token subsidy claimed via the community (this is your route — Qwen subsidy excludes Claude Code)

## 2. dev environment
- [ ] Node.js v18+ (`node --version`)
- [ ] Git identity set:
  ```bash
  git config user.name "Moren808"
  git config user.email "your@email.com"
  ```
- [ ] Public GitHub repo `watchdog-agent` created
- [ ] npm logged in (`npm whoami`) — you'll publish the package
- [ ] `.gitignore`: node_modules/, .env, dist/, *.json data files, .vercel

## 3. Bitget Agent Hub (verified)
- [ ] CLI installed: `npm install -g bitget-client`
- [ ] Public data works (no creds):
  ```bash
  bgc spot spot_get_ticker --symbol BTCUSDT
  bgc futures futures_get_funding_rate --productType USDT-FUTURES --symbol BTCUSDT
  ```
- [ ] Both return valid JSON; saved to docs/sample-outputs/
- [ ] (optional) MCP server added to Claude Code
- [ ] (optional) skills installed: `npx bitget-hub upgrade-all --target claude`

## 4. AI diagnosis smoke test (LAYER 3 gate)
- [ ] Confirm you can make one successful LLM API call with WATCHDOG_AI_API_KEY from Node
- [ ] Save a sample response so you know the shape before wiring diagnosis
- [ ] Decide model: MuleRun-subsidized (cost-free) preferred for the demo

## 5. package scaffold
- [ ] `package.json` name `watchdog-agent`, publishable (main, types, files)
- [ ] deps: express ; dev: typescript ts-node @types/node @types/express vitest
- [ ] `tsconfig.json` emits .d.ts to dist/
- [ ] full folder structure per CLAUDE.md (metrics/, intelligence/, engine/, store/, market/, server/, public/, examples/, test/)
- [ ] placeholder .ts files created
- [ ] `npx tsc --noEmit` passes on empty scaffold

## 6. design lock (before coding)
- [ ] Public API frozen — the Watchdog class + static getLeaderboard()/renderBadge() in CLAUDE.md is the contract
- [ ] Five metrics + default thresholds confirmed
- [ ] Trust score weighting decided (frequency + drawdown heaviest)
- [ ] The 10 chaos scenarios named, each mapped to the metric(s) it should trip (see CLAUDE.md PROOF 1)
- [ ] Three demo agents planned: demo-agent (good), chaos-agent (pulls overtrader scenario, the moment), fleet-demo (several scenarios at once → leaderboard)

## 7. research (grounds thresholds + diagnosis prompt)
- [ ] docs/failure-cases.md written: 238 trades/17 days; analysis paralysis; hype chasing
- [ ] Default thresholds chosen per metric, 1 line each on why (goes in README)
- [ ] Draft the diagnosis LLM prompt template (what context in, what report out)

## 8. deploy + submission prep
- [ ] Vercel account ready
- [ ] Deploy shape decided: dashboard + leaderboard + read API on Vercel, package on npm
- [ ] Project description drafted (≤200 words — in CLAUDE.md)
- [ ] Video plan (OBS/Loom) — must show integration + chaos pause + AI diagnosis + leaderboard
- [ ] X post drafted (#BitgetHackathon @ Bitget AI)
- [ ] Submission form bookmarked (opens June 10)

---

## phase 0 complete when:
`bgc spot spot_get_ticker --symbol BTCUSDT` returns JSON, one LLM diagnosis API call succeeds, the scaffold builds clean, and the public API is written down and frozen.

do not start phase 1 until the API contract is locked AND the AI call works.
