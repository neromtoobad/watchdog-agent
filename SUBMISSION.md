# WATCHDOG — Track 2 Submission

**Project:** WATCHDOG — a behavioral intelligence layer for autonomous trading agents.
**Track:** Track 2 — Trading Infra · Bitget AI Base Camp Hackathon S1
**Repo:** https://github.com/neromtoobad/watchdog-agent
**Live demo:** https://bitget-indol.vercel.app/app
**License:** MIT

## Project description (≤200 words · 195 words)

In 2026, AI trading agents caused over $45M in losses — not from bad code, but
bad behavior. One made 238 trades in 17 days, bleeding out on fees. Builders
monitor profit and loss. Nobody monitors whether an agent is behaving sanely,
and nobody can compare agents on behavior.

WATCHDOG wraps any Bitget agent in three lines. It assigns a live Trust Score
(0–100), predicts behavioral breaches before they happen, and on breach
generates a plain-English incident diagnosis using an LLM plus live Bitget
market context. It runs a public fleet leaderboard and renders embeddable trust
badges: a verifiable reputation layer for agents.

Every claim is proven. A deterministic chaos harness fires ten misbehavior
classes; WATCHDOG catches all of them — 100% detection, 0% false positives,
8.44 mean trades-to-detection. 192 tests pass. A hash-chained audit trail makes
every decision tamper-evident.

Competing tools are single-agent firewalls that block one trade; each is just
one of WATCHDOG's five guards. Model-agnostic AI (Qwen or Claude). Exposed as an
MCP server, so any agent gates trades with zero code.

Bitget modules: bgc spot and futures read-only market data, plus the GetAgent
Playbook. Three lines to integrate. No black boxes.
