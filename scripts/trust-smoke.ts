import { Watchdog, WatchdogConfig } from '../src/index';

const cfg: WatchdogConfig = {
  agentId: 'trust-smoke',
  portfolioUsdt: 10_000,
  rules: {
    maxTradesPerHour: 10,
    maxPositionSizePercent: 25,
    maxDrawdownPercent: 15,
    maxConsecutiveLosses: 4,
    maxSignalOverridesPerHour: 3,
  },
  onViolation: 'log', // don't pause so we can watch the score keep falling
};

console.warn = () => {};

async function main() {
  let passed = 0, failed = 0;
  const assert = (name: string, cond: boolean, detail?: string) => {
    if (cond) { passed++; console.log(`  ok  ${name}`); }
    else      { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
  };

  console.log('[1] good sequence: 3 small trades, 2 wins, 1 small loss → trust stays green');
  {
    const w = new Watchdog(cfg);
    const trail: number[] = [];
    for (let i = 0; i < 3; i++) {
      const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
      trail.push(d.trustScore);
    }
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 50 });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 30 });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -10 });
    const t = w.getTrustScore();
    console.log(`   trust trajectory: ${trail.join(' → ')} → final ${t.score} (${t.band}, ${t.trend})`);
    assert('every decision carried trustScore', trail.every((s) => typeof s === 'number'));
    assert('final score in healthy band', t.band === 'healthy', `score=${t.score} band=${t.band}`);
    assert('score ≥ 80', t.score >= 80, `score=${t.score}`);
  }

  console.log('\n[2] chaos sequence: 25 oversized rapid trades + 5 straight losses → cross bands');
  {
    const w = new Watchdog({ ...cfg, onViolation: 'log' });
    const trail: { i: number; score: number; band: string }[] = [];
    for (let i = 0; i < 25; i++) {
      const d = await w.checkTrade({
        type: 'open',
        symbol: 'BTCUSDT',
        sizeUsdt: 3500,           // 35% of portfolio → drift violation
        direction: 'long',
      });
      const t = w.getTrustScore();
      trail.push({ i, score: d.trustScore, band: t.band });
    }
    for (let i = 0; i < 5; i++) {
      w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -600 });
    }
    const t = w.getTrustScore();
    console.log(`   first 5: ${trail.slice(0, 5).map((x) => x.score).join(',')}`);
    console.log(`   last 5:  ${trail.slice(-5).map((x) => x.score).join(',')}`);
    console.log(`   final after closes: ${t.score} (${t.band}, ${t.trend})`);

    const startScore = trail[0].score;
    const endScore = t.score;
    assert('chaos drove score down', endScore < startScore, `start=${startScore} end=${endScore}`);
    assert('score crossed below 80 at some point', trail.some((x) => x.score < 80) || endScore < 80);
    assert('final score in caution or unsafe band', t.band !== 'healthy', `band=${t.band} score=${t.score}`);
    assert('trend reflects decline', t.trend === 'down' || endScore < 50, `trend=${t.trend} score=${t.score}`);
  }

  console.log('\n[3] reset restores trust to 100/healthy/flat');
  {
    const w = new Watchdog({ ...cfg, onViolation: 'log' });
    for (let i = 0; i < 30; i++) await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 3500, direction: 'long' });
    assert('trust dropped before reset', w.getTrustScore().score < 100);
    w.reset();
    const t = w.getTrustScore();
    assert('after reset score=100', t.score === 100);
    assert('after reset band=healthy', t.band === 'healthy');
    assert('after reset trend=flat', t.trend === 'flat');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
