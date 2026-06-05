import { Watchdog, WatchdogConfig } from '../src/index';

const cfg: WatchdogConfig = {
  agentId: 'smoke-1',
  portfolioUsdt: 10_000,
  rules: {
    maxTradesPerHour: 10,
    maxPositionSizePercent: 25,
    maxDrawdownPercent: 15,
    maxConsecutiveLosses: 4,
    maxSignalOverridesPerHour: 3,
  },
  onViolation: 'pause',
};

const originalWarn = console.warn;
let warnCount = 0;
console.warn = (...args: unknown[]) => { warnCount++; originalWarn('   ⚠ ', ...args); };

async function main() {
  let passed = 0, failed = 0;
  const assert = (name: string, cond: boolean, detail?: string) => {
    if (cond) { passed++; console.log(`  ok  ${name}`); }
    else      { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
  };

  console.log('\n[1] good sequence: one trade, approved');
  {
    const w = new Watchdog(cfg);
    const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    assert('approved=true', d.approved === true);
    assert('reason null', d.reason === null);
    assert('trustScore is a number', typeof d.trustScore === 'number');
    assert('action null', d.action === null);
    const s = w.getStatus();
    assert('status.metrics has all 5 metrics', Object.keys(s.metrics).length === 5);
    assert('not paused', s.paused === false);
  }

  console.log('\n[2] 30 rapid checkTrade calls trip frequency, agent pauses, subsequent calls block');
  {
    const w = new Watchdog(cfg);
    let approvedCount = 0, blockedCount = 0;
    let firstBlockedAt = -1;
    for (let i = 0; i < 30; i++) {
      const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 50, direction: 'long' });
      if (d.approved) approvedCount++;
      else {
        blockedCount++;
        if (firstBlockedAt < 0) firstBlockedAt = i;
      }
    }
    console.log(`   approved=${approvedCount}  blocked=${blockedCount}  firstBlockAt=${firstBlockedAt}  warnings=${warnCount}`);
    assert('some trades approved', approvedCount > 0);
    assert('some trades blocked', blockedCount > 0);
    assert('first block at trade 11 (after 10 trades fit, 11th violates)', firstBlockedAt === 10, `firstBlockedAt=${firstBlockedAt}`);
    assert('agent ended paused', w.getStatus().paused === true);
    const lastDecision = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 50, direction: 'long' });
    assert('already-paused returns approved:false immediately', lastDecision.approved === false);
    assert('paused reason mentions watchdog', !!lastDecision.reason && lastDecision.reason.includes('paused'));
    assert('paused action=pause', lastDecision.action === 'pause');
  }

  console.log('\n[3] reset clears paused + buffer');
  {
    const w = new Watchdog(cfg);
    for (let i = 0; i < 30; i++) {
      await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 50, direction: 'long' });
    }
    assert('paused before reset', w.getStatus().paused === true);
    w.reset();
    assert('not paused after reset', w.getStatus().paused === false);
    const evs = w.getEvents();
    const tradeOpens = evs.filter(e => e.type === 'trade-open').length;
    assert('trade-opens cleared after reset', tradeOpens === 0, `tradeOpens=${tradeOpens}`);
    const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 50, direction: 'long' });
    assert('post-reset trade approved', d.approved === true);
  }

  console.log('\n[4] onViolation=log does not block');
  {
    const w = new Watchdog({ ...cfg, onViolation: 'log' });
    let approvedCount = 0, blockedCount = 0;
    for (let i = 0; i < 30; i++) {
      const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 50, direction: 'long' });
      if (d.approved) approvedCount++; else blockedCount++;
    }
    console.log(`   log-mode approved=${approvedCount} blocked=${blockedCount}`);
    assert('log-mode never blocks', blockedCount === 0);
    assert('log-mode never pauses', w.getStatus().paused === false);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
