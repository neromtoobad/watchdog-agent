import { Watchdog, WatchdogConfig, WatchdogRules } from '../src/index';
import { SCENARIOS, CONTROL, Scenario } from '../chaos/scenarios';

console.warn = () => {};

const RULES: WatchdogRules = {
  maxTradesPerHour: 10,
  maxPositionSizePercent: 25,
  maxDrawdownPercent: 15,
  maxConsecutiveLosses: 4,
  maxSignalOverridesPerHour: 3,
};

function makeWatchdog(agentId: string): Watchdog {
  const cfg: WatchdogConfig = {
    agentId,
    portfolioUsdt: 10_000,
    rules: RULES,
    onViolation: 'log',
  };
  return new Watchdog(cfg);
}

async function runOne(s: Scenario) {
  const w = makeWatchdog(`chaos-${s.name}`);
  const t0 = Date.now();
  await s.run(w);
  const ms = Date.now() - t0;
  const status = w.getStatus();
  const violating = Object.values(status.metrics).filter(m => m.status === 'violation').map(m => m.name);
  const warning = Object.values(status.metrics).filter(m => m.status === 'warning').map(m => m.name);
  return { ms, trust: status.trustScore, violating, warning, events: w.getEvents().length };
}

async function main() {
  let passed = 0, failed = 0;
  const assert = (n: string, c: boolean, d?: string) => {
    if (c) { passed++; console.log(`  ok  ${n}`); }
    else   { failed++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); }
  };

  console.log('[scenarios — each runs error-free and reports its state]');
  console.log('name'.padEnd(20), 'ms'.padStart(4), 'trust'.padStart(6), 'band'.padEnd(8), 'violating'.padEnd(40), 'expected');
  for (const s of SCENARIOS) {
    let r;
    try {
      r = await runOne(s);
    } catch (e) {
      assert(`${s.name} runs without error`, false, (e as Error).message);
      continue;
    }
    console.log(
      s.name.padEnd(20),
      String(r.ms).padStart(4),
      String(r.trust.score).padStart(6),
      r.trust.band.padEnd(8),
      r.violating.join(',').padEnd(40),
      s.expectedViolations.join(','),
    );
    assert(`${s.name} runs without error`, true);
    assert(`${s.name} produced ≥1 event`, r.events >= 1, `events=${r.events}`);
  }

  console.log('\n[control — should trip nothing]');
  const cr = await runOne(CONTROL);
  console.log('control:', cr);
  assert('control runs without error', true);
  assert('control has no violating metrics', cr.violating.length === 0, cr.violating.join(','));
  assert('control trust stays healthy', cr.trust.band === 'healthy', `band=${cr.trust.band} score=${cr.trust.score}`);

  console.log('\n[determinism — same scenario twice produces same final trust score]');
  const a1 = await runOne(SCENARIOS[0]); // overtrader
  const a2 = await runOne(SCENARIOS[0]);
  assert('overtrader trust deterministic across runs', a1.trust.score === a2.trust.score, `${a1.trust.score} vs ${a2.trust.score}`);
  const b1 = await runOne(SCENARIOS[3]); // signal-flipper (uses RNG)
  const b2 = await runOne(SCENARIOS[3]);
  assert('signal-flipper deterministic across runs', b1.trust.score === b2.trust.score, `${b1.trust.score} vs ${b2.trust.score}`);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
