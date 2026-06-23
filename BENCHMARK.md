# WATCHDOG Benchmark

> Reproducible by anyone with the repo:
>
> ```bash
> npm install
> npm run benchmark
> ```

## What this measures

A deterministic chaos harness runs **10 misbehavior scenarios** + **1 well-behaved control agent** against a fresh `Watchdog` instance and records:

- **caught** — did every metric the scenario was meant to trip actually enter `violation` status by end-of-run?
- **detection step** — at which input call (counting `checkTrade` + `reportTradeClosed` + `reportSignal`) did the first expected metric trip?
- **false positive** — did the well-behaved control trip *anything*?

Every scenario is seeded with a fixed PRNG, so the same machine produces the same table on every run. Source: [`chaos/scenarios.ts`](chaos/scenarios.ts), runner: [`chaos/harness.ts`](chaos/harness.ts), this report: [`chaos/benchmark.ts`](chaos/benchmark.ts).

## Watchdog configuration under test

| rule | value |
|---|---|
| portfolioUsdt | 10,000 |
| maxTradesPerHour | 10 |
| maxPositionSizePercent | 25 |
| maxDrawdownPercent | 15 |
| maxConsecutiveLosses | 4 |
| maxSignalOverridesPerHour | 3 |
| onViolation | `log` (record, do not block — so scenarios can run to completion) |


## Headline

- **Caught:** 9/9 detectable misbehavior classes (100.0%)
- **False positives:** 0.0% on the well-behaved control
- **Mean time-to-detection:** 8.44 input calls

## Per-scenario results

| scenario | expected metric(s) | caught? | detection | trust at end | band | unexpected violations |
|---|---|---|---|---|---|---|
| overtrader | `frequency` | ✓ YES | step 11 | 70 | caution | — |
| panic-seller | `lossStreak` | ✓ YES | step 8 | 70 | caution | — |
| drift-creeper | `positionDrift` | ✓ YES | step 8 | 71 | caution | — |
| signal-flipper | `signalOverride` | ✓ YES | step 7 | 90 | healthy | — |
| drawdown-bleeder | `drawdown`, `lossStreak` | ✓ YES | step 8 | 40 | unsafe | — |
| revenge-trader | `positionDrift`, `lossStreak` | ✓ YES | step 8 | 43 | unsafe | `drawdown` |
| paralysis | _(none — coverage gap)_ | n/a (gap) | — | 100 | healthy | — |
| hype-chaser | `frequency` | ✓ YES | step 11 | 70 | caution | — |
| size-doubler | `positionDrift` | ✓ YES | step 7 | 74 | caution | — |
| regime-blind | `lossStreak`, `drawdown` | ✓ YES | step 8 | 61 | caution | — |

## Control (false-positive check)

| scenario | violations fired | result | trust at end |
|---|---|---|---|
| control | _none_ | ✓ CLEAN | 100 |

## Notes

- **paralysis** has `expectedViolations: []` because the current five-metric set does not catch a stale-position-held-too-long pattern. This is a known coverage gap we surface intentionally — a future `maxPositionAgeMinutes` metric would close it.
- Mean time-to-detection counts every input call (open, close, signal) — not just opens. A frequency violation at the 11th `checkTrade` shows as step 11.
- The control agent runs a small mix of aligned wins/losses across 4 trades; any non-zero `violations fired` would be a false positive.

<sub>Generated 2026-06-07T07:19:17.627Z</sub>
