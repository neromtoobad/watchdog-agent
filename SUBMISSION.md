# WATCHDOG — Track 2 Submission

**Project:** WATCHDOG — a behavioral intelligence layer for autonomous trading agents.
**Track:** Track 2 — Trading Infra · Bitget AI Base Camp Hackathon S1
**Repo:** https://github.com/neromtoobad/watchdog-agent
**License:** MIT

## Project description (≤200 words)

In 2026, AI trading agents caused over $45M in losses — not from bad code, but
bad behavior. One made 238 trades in 17 days, bleeding out on fees. Builders
monitor profit and loss. Nobody monitors whether an agent is acting sanely, and
nobody can compare agents on behavior at all.

WATCHDOG wraps any Bitget agent in three lines. It assigns a live Trust Score
(0–100), predicts behavioral breaches before they happen, and — the moment an
agent crosses a safe threshold — generates a plain-English incident diagnosis
using an LLM plus live Bitget market context. It runs a public fleet leaderboard
and renders embeddable trust badges: a verifiable reputation layer for agents.

Every claim is proven. A deterministic chaos harness fires ten misbehavior
classes; WATCHDOG catches them with a reproducible benchmark (100% detection,
0% false positives, 8.44 mean time-to-detection). 165 tests pass. A
hash-chained audit trail makes every decision tamper-evident.

Bitget modules used: bgc spot + futures (read-only public market data via Agent
Hub), and the GetAgent Playbook control plane — pipe any backtest through
WATCHDOG for a combined financial × behavioral report.

Three lines to integrate. Fully extensible. No black boxes.
