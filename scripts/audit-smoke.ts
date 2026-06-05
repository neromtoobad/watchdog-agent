import { Watchdog, WatchdogConfig } from '../src/index';
import { AuditChain } from '../src/intelligence/audit';

console.warn = () => {};

const cfg: WatchdogConfig = {
  agentId: 'audit-smoke',
  portfolioUsdt: 10_000,
  rules: {
    maxTradesPerHour: 5,
    maxPositionSizePercent: 25,
    maxDrawdownPercent: 10,
    maxConsecutiveLosses: 3,
    maxSignalOverridesPerHour: 3,
  },
  onViolation: 'log',
};

async function main() {
  let passed = 0, failed = 0;
  const assert = (n: string, c: boolean, d?: string) => {
    if (c) { passed++; console.log(`  ok  ${n}`); }
    else   { failed++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); }
  };

  console.log('[1] standalone AuditChain — append + verify + tamper-detect]');
  {
    const chain = new AuditChain();
    chain.append('decision', { idx: 0, foo: 'a' });
    chain.append('trust-update', { idx: 1, score: 90 });
    chain.append('violation', { idx: 2, reason: 'overtrade' });
    chain.append('trust-update', { idx: 3, score: 60 });

    const v1 = chain.verify();
    console.log('   verify (clean):', v1);
    assert('clean chain verifies valid=true', v1.valid === true && v1.brokenAt === null);

    // tamper with entry 2's payload — but leave hash alone → mismatch
    const trail = chain.getTrail();
    (trail[2].payload as { reason: string }).reason = 'innocent-edit';
    const v2 = chain.verify();
    console.log('   verify (tampered payload @2):', v2);
    assert('tamper detected at index 2', v2.valid === false && v2.brokenAt === 2);

    // restore, confirm valid again
    (trail[2].payload as { reason: string }).reason = 'overtrade';
    const v3 = chain.verify();
    assert('restore returns to valid', v3.valid === true);

    // tamper with prevHash on entry 3 — should break at 3
    const realPrev = trail[3].prevHash;
    trail[3].prevHash = 'f'.repeat(64);
    const v4 = chain.verify();
    console.log('   verify (tampered prevHash @3):', v4);
    assert('prevHash tamper detected at index 3', v4.valid === false && v4.brokenAt === 3);
    trail[3].prevHash = realPrev;
    assert('restore prevHash returns valid', chain.verify().valid === true);
  }

  console.log('\n[2] Watchdog: every checkTrade, recompute, incident appends to chain]');
  {
    const w = new Watchdog(cfg);
    for (let i = 0; i < 4; i++) {
      await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    }
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -50 });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 25 });

    const trail = w.getAuditTrail();
    const types: Record<string, number> = {};
    for (const e of trail) types[e.type] = (types[e.type] || 0) + 1;
    console.log('   chain length:', trail.length, 'types:', types);

    assert('contains decision entries', (types['decision'] ?? 0) === 4);
    assert('contains trust-update entries (one per intake)', (types['trust-update'] ?? 0) === 6);
    assert('chain verifies valid', w.verifyAuditChain().valid === true);

    // trigger a violation: 3 more trades pushes frequency over limit
    for (let i = 0; i < 3; i++) {
      await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    }
    const trail2 = w.getAuditTrail();
    const types2: Record<string, number> = {};
    for (const e of trail2) types2[e.type] = (types2[e.type] || 0) + 1;
    console.log('   after extra trades:', { len: trail2.length, types: types2 });
    assert('violation entry appended', (types2['violation'] ?? 0) >= 1);
    assert('chain still verifies', w.verifyAuditChain().valid === true);

    // tamper with a decision entry
    const decisionIdx = trail2.findIndex(e => e.type === 'decision');
    (trail2[decisionIdx].payload as Record<string, unknown>).agentId = 'pwned';
    const v = w.verifyAuditChain();
    console.log('   verify after tamper at index', decisionIdx, '→', v);
    assert('tamper detected via Watchdog.verifyAuditChain()', v.valid === false && v.brokenAt === decisionIdx);
  }

  console.log('\n[3] reset clears audit chain]');
  {
    const w = new Watchdog(cfg);
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    assert('chain has entries before reset', w.getAuditTrail().length > 0);
    w.reset();
    assert('chain empty after reset', w.getAuditTrail().length === 0);
    assert('empty chain verifies valid', w.verifyAuditChain().valid === true);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
