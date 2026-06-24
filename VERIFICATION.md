# Verification — every WATCHDOG claim, reproduced

This file maps each headline claim to (a) the command that reproduces it and
(b) the captured output committed in this repo. Nothing here is a mock-up — clone
the repo and you regenerate all of it.

| Claim | Reproduce | Captured proof |
|---|---|---|
| **10/10 misbehavior classes caught, 0% false positives, 8.44 mean time-to-detection** | `npm run benchmark` | [docs/evidence/benchmark-run.txt](docs/evidence/benchmark-run.txt) · [BENCHMARK.md](BENCHMARK.md) |
| **192/192 tests pass** | `npm test` | [docs/sample-outputs/test-run.txt](docs/sample-outputs/test-run.txt) |
| **Live trust gating (approve → block → auto-pause)** | see snippet below | [docs/sample-outputs/checktrade-sample.json](docs/sample-outputs/checktrade-sample.json) |
| **Tamper-evident, hash-chained audit trail** | `npx ts-node` snippet | [docs/evidence/audit-tamper-demo.txt](docs/evidence/audit-tamper-demo.txt) · [audit-trail.json](docs/evidence/audit-trail.json) |
| **AI incident diagnosis** | violation triggers it; key optional | [docs/sample-outputs/diagnosis-sample.json](docs/sample-outputs/diagnosis-sample.json) |
| **Live read-only Bitget market data** | `GET /api/market` | [docs/sample-outputs/ticker-sample.json](docs/sample-outputs/ticker-sample.json) · live below |
| **Deployed, public, live** | open the URL | [docs/evidence/live-api-snapshot.json](docs/evidence/live-api-snapshot.json) |

---

## 1. The benchmark (detection rate, false positives, time-to-detection)

```bash
npm run benchmark
```

Captured run — [docs/evidence/benchmark-run.txt](docs/evidence/benchmark-run.txt):

```
scenario             expected                       caught      detect   trust  band
overtrader           frequency                      ✓ YES       step 11  70     caution
panic-seller         lossStreak                     ✓ YES       step 8   70     caution
drift-creeper        positionDrift                  ✓ YES       step 8   71     caution
signal-flipper       signalOverride                 ✓ YES       step 7   90     healthy
drawdown-bleeder     drawdown,lossStreak            ✓ YES       step 8   40     unsafe
revenge-trader       positionDrift,lossStreak       ✓ YES       step 8   43     unsafe
hype-chaser          frequency                      ✓ YES       step 11  70     caution
size-doubler         positionDrift                  ✓ YES       step 7   74     caution
regime-blind         lossStreak,drawdown            ✓ YES       step 8   61     caution
control              n/a                            CLEAN       —        100    healthy
caught 9/9 detectable | detection rate 100.0% | false-positives 0.0% | mean time-to-detection 8.44 steps
```

(`paralysis` is intentionally listed as a non-detectable control gap — an agent
that simply never exits — so the suite proves WATCHDOG does **not** fabricate a
catch where there is none.)

## 2. The tests

```bash
npm test     # 192/192 — log at docs/sample-outputs/test-run.txt
```

## 3. Live trust gating — sample input → output

Full record (5 approved, 3 blocked, trust falls, auto-pause) in
[docs/sample-outputs/checktrade-sample.json](docs/sample-outputs/checktrade-sample.json):

```ts
const w = new Watchdog({ agentId: 'a', portfolioUsdt: 10000,
  rules: { maxTradesPerHour: 5, /* … */ }, onViolation: 'pause' });
for (let i = 0; i < 8; i++)
  console.log(await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' }));
// → calls 1-5 approved; call 6+ blocked, reason "frequency: 6 trades in last hour exceeds limit of 5", trust drops, paused=true
```

## 4. Tamper-evident audit trail

Every decision, metric evaluation and trust change is hash-chained
(`hash = sha256(prevHash + payload + timestamp)`). Rewriting any past entry
breaks verification at exactly that index. Captured demo —
[docs/evidence/audit-tamper-demo.txt](docs/evidence/audit-tamper-demo.txt):

```
STEP 1 — verify intact chain:   valid=true   brokenAt=null
STEP 2 — tamper with entry [2] (rewrite its payload)
STEP 3 — re-verify:             valid=false  brokenAt=2
RESULT: PASS — tampering is detected immediately.
```

## 5. Live deployment (public, no login)

- Dashboard: https://watchdog-bitget.vercel.app/app
- Leaderboard: https://watchdog-bitget.vercel.app/leaderboard.html
- Live market: https://watchdog-bitget.vercel.app/api/market
- Live trust badge (SVG): https://watchdog-bitget.vercel.app/badge/charlie-bleeder

```bash
curl https://watchdog-bitget.vercel.app/api/leaderboard
curl https://watchdog-bitget.vercel.app/api/market     # live Bitget price, read-only
```

A timestamped snapshot of these live responses is committed at
[docs/evidence/live-api-snapshot.json](docs/evidence/live-api-snapshot.json).
