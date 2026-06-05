import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

for (const file of ['.env', '.env.example']) {
  const p = path.join(__dirname, '..', file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const KEY = process.env.BITGET_PLAYBOOK_KEY!;

function get(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { method: 'GET', hostname: u.hostname, path: u.pathname + u.search, headers: { 'ACCESS-KEY': KEY }, timeout: 20_000 },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(b)); },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

(async () => {
  const raw = await get('https://api.bitget.com/api/v1/playbook/list?status=published&limit=20');
  const parsed = JSON.parse(raw);
  const items = parsed?.data?.items ?? [];
  console.log(`${items.length} published playbooks:\n`);
  console.log('idx  name'.padEnd(45) + 'backtest_support  runtime_profile  trades  return%  version_id');
  console.log('─'.repeat(140));
  items.forEach((it: any, i: number) => {
    const m = it.official_metrics?.summary ?? {};
    console.log(
      `${String(i).padStart(3)}  ${(it.name ?? '?').padEnd(40)}` +
      `${(it.backtest_support ?? '?').padEnd(18)}` +
      `${(it.runtime_profile ?? '?').padEnd(17)}` +
      `${String(m.total_trades ?? '?').padStart(6)}  ` +
      `${typeof m.total_return_pct === 'number' ? m.total_return_pct.toFixed(2) : '?'.padStart(6)}  ` +
      `${it.version_id}`
    );
  });
})();
