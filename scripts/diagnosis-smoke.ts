import * as fs from 'fs';
import * as path from 'path';
import { Watchdog, WatchdogConfig } from '../src/index';

// load .env.example into process.env (real .env would be similar)
const envPath = path.join(__dirname, '..', '.env.example');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && m[2]) process.env[m[1]] = m[2];
}

console.warn = () => {};

const cfg: WatchdogConfig = {
  agentId: 'diagnosis-smoke',
  portfolioUsdt: 10_000,
  rules: {
    maxTradesPerHour: 5,
    maxPositionSizePercent: 25,
    maxDrawdownPercent: 15,
    maxConsecutiveLosses: 4,
    maxSignalOverridesPerHour: 3,
  },
  onViolation: 'log',
  ai: { enabled: true },
};

async function main() {
  let passed = 0, failed = 0;
  const assert = (n: string, c: boolean, d?: string) => {
    if (c) { passed++; console.log(`  ok  ${n}`); }
    else   { failed++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); }
  };

  console.log('[force violation → diagnosis fires]');
  const w = new Watchdog(cfg);

  // 6 rapid opens — limit is 5 → frequency violation on the 6th
  let firstViolation = -1;
  for (let i = 0; i < 7; i++) {
    const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 1500, direction: 'long' });
    if (!d.approved || (d.reason && d.reason.includes('exceeds')) ) {
      // approved=true is fine in log mode
    }
    if (w.getLastDiagnosis() && firstViolation < 0) firstViolation = i;
  }

  const before = w.getLastDiagnosis();
  console.log('   pre-flush diagnosis (may be null while AI in flight):', before ? before.source : 'null');

  const diag = await w.flushDiagnosis();
  console.log('\nDIAGNOSIS RESULT:');
  console.log(JSON.stringify(diag, null, 2));

  assert('diagnosis produced', diag !== null);
  if (!diag) { console.log(`\n${passed} passed, ${failed} failed`); process.exit(1); }
  assert('summary present', typeof diag.summary === 'string' && diag.summary.length > 5);
  assert('likelyCause present', typeof diag.likelyCause === 'string' && diag.likelyCause.length > 3);
  assert('recommendation present', typeof diag.recommendation === 'string' && diag.recommendation.length > 3);
  assert('source is ai or fallback', diag.source === 'ai' || diag.source === 'fallback');
  assert('context carries metricStates', Array.isArray((diag.context as any).metricStates));
  const mc: any = (diag.context as any).marketContext;
  assert('context carries marketContext object', mc !== null && typeof mc === 'object');
  assert('marketContext.symbol is BTCUSDT', mc?.symbol === 'BTCUSDT');
  console.log(`   marketContext: lastPrice=${mc?.lastPrice} fundingRate=${mc?.fundingRate} vol24h=${mc?.recentVolatility}%`);
  console.log(`   source=${diag.source} (ai=real LLM, fallback=template)`);

  console.log('\n[2] reset clears the diagnosis cache');
  w.reset();
  assert('after reset getLastDiagnosis()=null', w.getLastDiagnosis() === null);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
