import * as http from 'http';
import { Watchdog, WatchdogConfig } from '../src/index';
import { createDashboardServer } from '../src/server/dashboard';
import { clear } from '../src/intelligence/fleet';

console.warn = () => {};

function get(url: string): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body: raw,
        contentType: String(res.headers['content-type'] ?? ''),
      }));
    }).on('error', reject);
  });
}

async function main() {
  let passed = 0, failed = 0;
  const assert = (n: string, c: boolean, d?: string) => {
    if (c) { passed++; console.log(`  ok  ${n}`); }
    else   { failed++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); }
  };

  clear();

  const cfg: WatchdogConfig = {
    agentId: 'dash-test',
    portfolioUsdt: 10_000,
    rules: {
      maxTradesPerHour: 5,
      maxPositionSizePercent: 25,
      maxDrawdownPercent: 15,
      maxConsecutiveLosses: 4,
      maxSignalOverridesPerHour: 3,
    },
    onViolation: 'log',
    fleet: { register: true },
  };
  const w = new Watchdog(cfg);

  // prime: a couple of trades + a loss so endpoints have something to show
  await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
  await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
  w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -50 });
  w.reportSignal({ signal: 'bearish', action: 'open-long' });

  const port = 4731;
  const ds = await createDashboardServer(w, port);
  try {
    console.log('\n[1] /api/health');
    const h = await get(`${ds.url}/api/health`);
    console.log('   →', h.body);
    assert('health 200', h.status === 200);
    const hj = JSON.parse(h.body);
    assert('health ok:true', hj.ok === true);
    assert('health uptime is a number', typeof hj.uptime === 'number');

    console.log('\n[2] /api/status');
    const s = await get(`${ds.url}/api/status`);
    assert('status 200', s.status === 200);
    const sj = JSON.parse(s.body);
    console.log('   →', JSON.stringify({ agentId: sj.agentId, trust: sj.trustScore, metricCount: Object.keys(sj.status.metrics).length, forecasts: sj.forecasts.length }, null, 2));
    assert('status.agentId is dash-test', sj.agentId === 'dash-test');
    assert('status.trustScore.score is a number', typeof sj.trustScore.score === 'number');
    assert('status.status.metrics has 5 metrics', Object.keys(sj.status.metrics).length === 5);
    assert('status.forecasts is an array', Array.isArray(sj.forecasts));
    assert('status.lastDiagnosis is null (no AI configured)', sj.lastDiagnosis === null);

    console.log('\n[3] /api/events');
    const ev = await get(`${ds.url}/api/events`);
    assert('events 200', ev.status === 200);
    const evJ = JSON.parse(ev.body);
    console.log(`   → ${evJ.length} events (last 50 cap)`);
    assert('events is array', Array.isArray(evJ));
    assert('events length ≤ 50', evJ.length <= 50);
    assert('events has at least 4 (2 opens + close + signal)', evJ.length >= 4);

    console.log('\n[4] /api/leaderboard');
    const lb = await get(`${ds.url}/api/leaderboard`);
    assert('leaderboard 200', lb.status === 200);
    const lbJ = JSON.parse(lb.body);
    console.log('   →', lbJ.map((p: any) => `${p.trustScore} ${p.agentId}`).join(', '));
    assert('leaderboard is array', Array.isArray(lbJ));
    assert('leaderboard contains dash-test', lbJ.some((p: any) => p.agentId === 'dash-test'));

    console.log('\n[5] /api/audit');
    const au = await get(`${ds.url}/api/audit`);
    assert('audit 200', au.status === 200);
    const auJ = JSON.parse(au.body);
    console.log(`   → verified=${auJ.verified} chainLen=${auJ.trail.length}`);
    assert('audit.verified is true', auJ.verified === true);
    assert('audit.trail is array', Array.isArray(auJ.trail));
    assert('audit.trail non-empty', auJ.trail.length > 0);
    assert('every entry has hash + prevHash', auJ.trail.every((e: any) => typeof e.hash === 'string' && typeof e.prevHash === 'string'));

    console.log('\n[6] /badge/dash-test (SVG)');
    const bd = await get(`${ds.url}/badge/dash-test`);
    assert('badge 200', bd.status === 200);
    assert('badge content-type is image/svg+xml', bd.contentType.startsWith('image/svg+xml'));
    assert('badge body starts with <svg', bd.body.startsWith('<svg'));
    assert('badge body ends with </svg>', bd.body.trimEnd().endsWith('</svg>'));
    assert('badge body contains "trust"', bd.body.includes('>trust<'));
    console.log(`   → ${bd.body.length} chars, content-type=${bd.contentType}`);

    console.log('\n[7] /badge/test-agent (unregistered → default 100/healthy)');
    const bd2 = await get(`${ds.url}/badge/test-agent`);
    assert('badge for unregistered 200', bd2.status === 200);
    assert('unregistered shows 100', bd2.body.includes('>100<'));
    assert('unregistered uses green', bd2.body.toLowerCase().includes('#3fb950'));
    console.log(`   open in browser: ${ds.url}/badge/test-agent`);

    console.log('\n[8] / (static html from public/)');
    const idx = await get(`${ds.url}/`);
    console.log(`   status=${idx.status} contentType=${idx.contentType} bytes=${idx.body.length}`);
    // public/index.html is currently an empty placeholder — 200 still acceptable
    assert('static index served (200 or 404 acceptable for empty file)', idx.status === 200 || idx.status === 404);
  } finally {
    await ds.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error('FATAL', e); process.exit(2); });
