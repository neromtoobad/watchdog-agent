import * as fs from 'fs';
import * as path from 'path';
import { runChaosSuite, DEFAULT_RULES, ChaosResult, ScenarioResult } from './harness';

const OUT_PATH = path.resolve(__dirname, '..', 'BENCHMARK.md');

const METHODOLOGY = `# WATCHDOG Benchmark

> Reproducible by anyone with the repo:
>
> \`\`\`bash
> npm install
> npm run benchmark
> \`\`\`

## What this measures

A deterministic chaos harness runs **10 misbehavior scenarios** + **1 well-behaved control agent** against a fresh \`Watchdog\` instance and records:

- **caught** — did every metric the scenario was meant to trip actually enter \`violation\` status by end-of-run?
- **detection step** — at which input call (counting \`checkTrade\` + \`reportTradeClosed\` + \`reportSignal\`) did the first expected metric trip?
- **false positive** — did the well-behaved control trip *anything*?

Every scenario is seeded with a fixed PRNG, so the same machine produces the same table on every run. Source: [\`chaos/scenarios.ts\`](chaos/scenarios.ts), runner: [\`chaos/harness.ts\`](chaos/harness.ts), this report: [\`chaos/benchmark.ts\`](chaos/benchmark.ts).

## Watchdog configuration under test

| rule | value |
|---|---|
| portfolioUsdt | 10,000 |
| maxTradesPerHour | ${DEFAULT_RULES.maxTradesPerHour} |
| maxPositionSizePercent | ${DEFAULT_RULES.maxPositionSizePercent} |
| maxDrawdownPercent | ${DEFAULT_RULES.maxDrawdownPercent} |
| maxConsecutiveLosses | ${DEFAULT_RULES.maxConsecutiveLosses} |
| maxSignalOverridesPerHour | ${DEFAULT_RULES.maxSignalOverridesPerHour} |
| onViolation | \`log\` (record, do not block — so scenarios can run to completion) |
`;

function fmtDetect(r: ScenarioResult): string {
  if (r.detectionTradeIndex === null) {
    return r.expected.length === 0 ? '—' : 'NEVER';
  }
  return `step ${r.detectionTradeIndex}`;
}

function caughtCell(r: ScenarioResult): string {
  if (r.expected.length === 0) return 'n/a (gap)';
  return r.caught ? '✓ YES' : '✗ NO';
}

function buildMarkdown(result: ChaosResult): string {
  const { scenarios, control, aggregates } = result;
  const caughtCount = scenarios.filter((r) => r.caught && r.expected.length > 0).length;
  const totalDetectable = aggregates.detectableScenarios;

  const lines: string[] = [];
  lines.push(METHODOLOGY);

  // headline
  lines.push('');
  lines.push('## Headline');
  lines.push('');
  lines.push(`- **Caught:** ${caughtCount}/${totalDetectable} detectable misbehavior classes (${(aggregates.detectionRate * 100).toFixed(1)}%)`);
  lines.push(`- **False positives:** ${(aggregates.falsePositiveRate * 100).toFixed(1)}% on the well-behaved control`);
  lines.push(`- **Mean time-to-detection:** ${aggregates.meanTimeToDetection.toFixed(2)} input calls`);
  lines.push('');

  // per-scenario table
  lines.push('## Per-scenario results');
  lines.push('');
  lines.push('| scenario | expected metric(s) | caught? | detection | trust at end | band | unexpected violations |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of scenarios) {
    lines.push(
      `| ${r.name} | ${r.expected.length === 0 ? '_(none — coverage gap)_' : '`' + r.expected.join('`, `') + '`'} | ${caughtCell(r)} | ${fmtDetect(r)} | ${r.trustFinal} | ${r.trustBand} | ${r.unexpectedMetrics.length === 0 ? '—' : '`' + r.unexpectedMetrics.join('`, `') + '`'} |`,
    );
  }
  lines.push('');

  // control
  lines.push('## Control (false-positive check)');
  lines.push('');
  lines.push('| scenario | violations fired | result | trust at end |');
  lines.push('|---|---|---|---|');
  lines.push(
    `| ${control.name} | ${control.unexpectedMetrics.length === 0 ? '_none_' : '`' + control.unexpectedMetrics.join('`, `') + '`'} | ${control.falsePositive ? '✗ FALSE POSITIVE' : '✓ CLEAN'} | ${control.trustFinal} |`,
  );
  lines.push('');

  // notes
  lines.push('## Notes');
  lines.push('');
  lines.push('- **paralysis** has `expectedViolations: []` because the current five-metric set does not catch a stale-position-held-too-long pattern. This is a known coverage gap we surface intentionally — a future `maxPositionAgeMinutes` metric would close it.');
  lines.push('- Mean time-to-detection counts every input call (open, close, signal) — not just opens. A frequency violation at the 11th `checkTrade` shows as step 11.');
  lines.push('- The control agent runs a small mix of aligned wins/losses across 4 trades; any non-zero `violations fired` would be a false positive.');
  lines.push('');

  lines.push(`<sub>Generated ${new Date().toISOString()}</sub>`);
  lines.push('');
  return lines.join('\n');
}

function printConsoleTable(result: ChaosResult): void {
  console.log('\nWATCHDOG benchmark');
  console.log('━'.repeat(108));
  console.log(
    'scenario'.padEnd(20),
    'expected'.padEnd(30),
    'caught'.padEnd(11),
    'detect'.padEnd(8),
    'trust'.padEnd(6),
    'band'.padEnd(9),
    'unexpected',
  );
  console.log('─'.repeat(108));
  for (const r of result.scenarios) {
    console.log(
      r.name.padEnd(20),
      (r.expected.join(',') || '—').padEnd(30),
      caughtCell(r).padEnd(11),
      fmtDetect(r).padEnd(8),
      String(r.trustFinal).padEnd(6),
      r.trustBand.padEnd(9),
      r.unexpectedMetrics.join(',') || '—',
    );
  }
  console.log('─'.repeat(108));
  console.log(
    result.control.name.padEnd(20),
    'n/a'.padEnd(30),
    (result.control.falsePositive ? 'FALSE+' : 'CLEAN').padEnd(11),
    '—'.padEnd(8),
    String(result.control.trustFinal).padEnd(6),
    result.control.trustBand.padEnd(9),
    result.control.unexpectedMetrics.join(',') || '—',
  );
  console.log('━'.repeat(108));
  const a = result.aggregates;
  const caughtCount = result.scenarios.filter((r) => r.caught && r.expected.length > 0).length;
  console.log(
    `caught ${caughtCount}/${a.detectableScenarios} detectable | detection rate ${(a.detectionRate * 100).toFixed(1)}% | false-positives ${(a.falsePositiveRate * 100).toFixed(1)}% | mean time-to-detection ${a.meanTimeToDetection.toFixed(2)} steps`,
  );
}

async function main() {
  // silence violation warnings while running
  const origWarn = console.warn;
  console.warn = () => {};
  const result = await runChaosSuite();
  console.warn = origWarn;

  printConsoleTable(result);

  const md = buildMarkdown(result);
  fs.writeFileSync(OUT_PATH, md);
  console.log(`\nwrote ${OUT_PATH} (${md.length} chars)`);

  const allCaught = result.scenarios.every((r) => r.caught);
  const cleanControl = !result.control.falsePositive;
  if (!allCaught || !cleanControl) {
    console.error('\nFAIL: missed a scenario or control produced a false positive.');
    process.exit(1);
  }
  console.log('PASS: all detectable scenarios caught, control clean.');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(2);
});
