/**
 * playbook-list.ts — list the playbooks visible to your BITGET_PLAYBOOK_KEY.
 *
 * Hits two endpoints from the getagent-skill reference:
 *   GET /api/v1/playbook/my-playbooks  — your subscriptions/owned playbooks
 *   GET /api/v1/playbook/list?status=draft — your draft versions
 *   GET /api/v1/playbook/list           — the public catalog (no auth needed)
 *
 * Prints any version_ids it finds, so you can plug the right one into
 * PLAYBOOK_VERSION_ID in .env.
 *
 *   npx ts-node scripts/playbook-list.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// load .env + .env.example
for (const file of ['.env', '.env.example']) {
  const p = path.join(__dirname, '..', file);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const KEY = process.env.BITGET_PLAYBOOK_KEY || process.env.BITGET_ACCESS_KEY;

function get(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { method: 'GET', hostname: u.hostname, path: u.pathname + u.search, headers, timeout: 20_000 },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function probe(label: string, url: string, withAuth: boolean) {
  console.log(`\n── ${label} ──`);
  console.log(`  ${url}`);
  if (withAuth && !KEY) { console.log('  (no key set — skipping)'); return; }
  const headers: Record<string, string> = withAuth && KEY ? { 'ACCESS-KEY': KEY } : {};
  try {
    const r = await get(url, headers);
    console.log(`  HTTP ${r.status}`);
    let parsed: unknown = r.body;
    try { parsed = JSON.parse(r.body); } catch { /* leave as text */ }
    const pretty = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
    console.log(pretty.length > 4000 ? pretty.slice(0, 4000) + '\n  …(truncated)' : pretty);

    // try to surface version_ids
    if (typeof parsed === 'object' && parsed !== null) {
      const versionIds: string[] = [];
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') {
          for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
            if (k === 'version_id' && typeof val === 'string') versionIds.push(val);
            else walk(val);
          }
        }
      };
      walk(parsed);
      if (versionIds.length > 0) {
        console.log(`\n  ★ FOUND ${versionIds.length} version_id(s):`);
        for (const v of versionIds) console.log(`     PLAYBOOK_VERSION_ID=${v}`);
      }
    }
  } catch (e) {
    console.log(`  ERR: ${(e as Error).message}`);
  }
}

(async () => {
  console.log('playbook-list — discovering version_ids visible to your key');
  console.log(`key source: ${process.env.BITGET_PLAYBOOK_KEY ? 'BITGET_PLAYBOOK_KEY' : process.env.BITGET_ACCESS_KEY ? 'BITGET_ACCESS_KEY' : '(none)'}`);

  await probe('public catalog (auth, status=published)',  'https://api.bitget.com/api/v1/playbook/list?status=published&limit=10',  true);
  await probe('public catalog (auth, status=active)',     'https://api.bitget.com/api/v1/playbook/list?status=active&limit=10',     true);
  await probe('public catalog (auth, no status)',         'https://api.bitget.com/api/v1/playbook/list?limit=10',                    true);
  await probe('your drafts (auth)',                       'https://api.bitget.com/api/v1/playbook/list?status=draft',                true);
  await probe('your subscriptions (auth)',                'https://api.bitget.com/api/v1/playbook/my-playbooks',                     true);
})();
