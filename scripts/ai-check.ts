import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const envPath = path.join(__dirname, '..', '.env.example');
const env: Record<string, string> = {};
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const apiKey = env.WATCHDOG_AI_API_KEY;
const model = env.WATCHDOG_AI_MODEL;
if (!apiKey || !model) { console.error('missing key or model'); process.exit(1); }

const body = JSON.stringify({
  model,
  max_tokens: 32,
  messages: [{ role: 'user', content: 'reply with OK' }],
});

const req = https.request({
  hostname: 'api.anthropic.com',
  path: '/v1/messages',
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-length': Buffer.byteLength(body),
  },
}, (res) => {
  let raw = '';
  res.on('data', (c) => (raw += c));
  res.on('end', () => {
    const outPath = path.join(__dirname, '..', 'docs', 'sample-outputs', 'ai-sample.json');
    let parsed: unknown = raw;
    try { parsed = JSON.parse(raw); } catch {}
    fs.writeFileSync(outPath, JSON.stringify({ status: res.statusCode, body: parsed }, null, 2));
    console.log('STATUS', res.statusCode);
    console.log(raw);
  });
});
req.on('error', (e) => { console.error('ERR', e.message); process.exit(1); });
req.write(body);
req.end();
