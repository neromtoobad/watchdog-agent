import { Watchdog, WatchdogConfig, WatchdogRules } from '../src/index';
import { SCENARIOS, CONTROL, Scenario } from './scenarios';

export interface ScenarioResult {
  name: string;
  expected: string[];
  caught: boolean;             // every expected violation actually fired
  caughtMetrics: string[];     // which expected metrics fired
  missedMetrics: string[];     // expected but didn't fire
  unexpectedMetrics: string[]; // fired but weren't expected
  detectionTradeIndex: number | null; // step at which the FIRST expected metric tripped
  totalSteps: number;
  trustFinal: number;
  trustBand: string;
  falsePositive: boolean;      // only meaningful for the control
}

export interface ChaosResult {
  scenarios: ScenarioResult[];
  control: ScenarioResult;
  aggregates: {
    totalScenarios: number;
    detectableScenarios: number; // scenarios with non-empty expectedViolations
    detectionRate: number;       // caught / detectable
    falsePositiveRate: number;   // 0..1, here 0 or 1 with single control
    meanTimeToDetection: number; // avg detectionTradeIndex over caught+detectable
  };
}

export const DEFAULT_RULES: WatchdogRules = {
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
    rules: DEFAULT_RULES,
    onViolation: 'log',
  };
  return new Watchdog(cfg);
}

/**
 * Wraps the Watchdog's three input methods so the harness can record
 * which metrics first entered 'violation' on which step. Returns a
 * snapshot collector that captures violating metric names per step.
 */
function instrument(w: Watchdog): {
  firstSeen: Record<string, number>;
  steps: () => number;
} {
  const firstSeen: Record<string, number> = {};
  let step = 0;

  const snapshot = () => {
    const status = w.getStatus();
    for (const m of Object.values(status.metrics)) {
      if (m.status === 'violation' && !(m.name in firstSeen)) {
        firstSeen[m.name] = step;
      }
    }
  };

  const origCheck = w.checkTrade.bind(w);
  (w as any).checkTrade = async (t: Parameters<Watchdog['checkTrade']>[0]) => {
    step++;
    const r = await origCheck(t);
    snapshot();
    return r;
  };
  const origClose = w.reportTradeClosed.bind(w);
  (w as any).reportTradeClosed = (c: Parameters<Watchdog['reportTradeClosed']>[0]) => {
    step++;
    origClose(c);
    snapshot();
  };
  const origSig = w.reportSignal.bind(w);
  (w as any).reportSignal = (s: Parameters<Watchdog['reportSignal']>[0]) => {
    step++;
    origSig(s);
    snapshot();
  };

  return { firstSeen, steps: () => step };
}

async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const w = makeWatchdog(`chaos-${s.name}`);
  const probe = instrument(w);
  await s.run(w);
  const status = w.getStatus();
  const allFired = Object.keys(probe.firstSeen);

  const caughtMetrics = s.expectedViolations.filter((n) => n in probe.firstSeen);
  const missedMetrics = s.expectedViolations.filter((n) => !(n in probe.firstSeen));
  const unexpectedMetrics = allFired.filter((n) => !s.expectedViolations.includes(n));

  const expectedStepIndices = s.expectedViolations
    .map((n) => probe.firstSeen[n])
    .filter((v): v is number => typeof v === 'number');
  const detectionTradeIndex = expectedStepIndices.length > 0 ? Math.min(...expectedStepIndices) : null;

  const caught = s.expectedViolations.length === 0 ? true : missedMetrics.length === 0;

  return {
    name: s.name,
    expected: s.expectedViolations,
    caught,
    caughtMetrics,
    missedMetrics,
    unexpectedMetrics,
    detectionTradeIndex,
    totalSteps: probe.steps(),
    trustFinal: status.trustScore.score,
    trustBand: status.trustScore.band,
    falsePositive: false,
  };
}

async function runControl(): Promise<ScenarioResult> {
  const w = makeWatchdog('chaos-control');
  const probe = instrument(w);
  await CONTROL.run(w);
  const status = w.getStatus();
  const allFired = Object.keys(probe.firstSeen);

  return {
    name: CONTROL.name,
    expected: CONTROL.expectedViolations,
    caught: allFired.length === 0, // a clean control "catches" nothing
    caughtMetrics: [],
    missedMetrics: [],
    unexpectedMetrics: allFired,
    detectionTradeIndex: null,
    totalSteps: probe.steps(),
    trustFinal: status.trustScore.score,
    trustBand: status.trustScore.band,
    falsePositive: allFired.length > 0,
  };
}

export async function runChaosSuite(): Promise<ChaosResult> {
  const scenarios: ScenarioResult[] = [];
  for (const s of SCENARIOS) scenarios.push(await runScenario(s));
  const control = await runControl();

  const detectable = scenarios.filter((r) => r.expected.length > 0);
  const caughtAmongDetectable = detectable.filter((r) => r.caught);
  const detectionTimes = caughtAmongDetectable
    .map((r) => r.detectionTradeIndex)
    .filter((v): v is number => typeof v === 'number');
  const detectionRate = detectable.length === 0 ? 1 : caughtAmongDetectable.length / detectable.length;
  const meanTimeToDetection =
    detectionTimes.length === 0
      ? 0
      : detectionTimes.reduce((a, b) => a + b, 0) / detectionTimes.length;
  const falsePositiveRate = control.falsePositive ? 1 : 0;

  return {
    scenarios,
    control,
    aggregates: {
      totalScenarios: scenarios.length,
      detectableScenarios: detectable.length,
      detectionRate,
      falsePositiveRate,
      meanTimeToDetection,
    },
  };
}

if (require.main === module) {
  (async () => {
    // silence noisy violation warnings during the run
    const origWarn = console.warn;
    console.warn = () => {};
    const result = await runChaosSuite();
    console.warn = origWarn;

    console.log('\nWATCHDOG chaos suite results');
    console.log('━'.repeat(110));
    console.log(
      'scenario'.padEnd(20),
      'caught'.padEnd(7),
      'detect@'.padEnd(8),
      'trust'.padEnd(6),
      'band'.padEnd(9),
      'expected'.padEnd(28),
      'unexpected',
    );
    console.log('─'.repeat(110));
    for (const r of result.scenarios) {
      console.log(
        r.name.padEnd(20),
        (r.caught ? 'YES' : 'NO').padEnd(7),
        String(r.detectionTradeIndex ?? '—').padEnd(8),
        String(r.trustFinal).padEnd(6),
        r.trustBand.padEnd(9),
        r.expected.join(',').padEnd(28),
        r.unexpectedMetrics.join(',') || '—',
      );
    }
    console.log('─'.repeat(110));
    const c = result.control;
    console.log(
      c.name.padEnd(20),
      (c.falsePositive ? 'FALSE+' : 'CLEAN').padEnd(7),
      String(c.detectionTradeIndex ?? '—').padEnd(8),
      String(c.trustFinal).padEnd(6),
      c.trustBand.padEnd(9),
      '(none expected)'.padEnd(28),
      c.unexpectedMetrics.join(',') || '—',
    );
    console.log('━'.repeat(110));
    const a = result.aggregates;
    const caughtCount = result.scenarios.filter((r) => r.caught).length;
    console.log(
      `caught ${caughtCount}/${a.totalScenarios} scenarios | detection rate ${(a.detectionRate * 100).toFixed(1)}% on ${a.detectableScenarios} detectable | false-positives ${(a.falsePositiveRate * 100).toFixed(1)}% | mean time-to-detection ${a.meanTimeToDetection.toFixed(2)} steps`,
    );

    const allCaught = result.scenarios.every((r) => r.caught);
    const cleanControl = !result.control.falsePositive;
    if (!allCaught || !cleanControl) {
      console.error('\nFAIL: not all scenarios caught or control produced a false positive.');
      process.exit(1);
    }
    console.log('\nOK: all scenarios caught, control is clean.');
  })();
}
