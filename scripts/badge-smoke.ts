import * as fs from 'fs';
import * as path from 'path';
import { renderBadge } from '../src/badge/render';
import { Watchdog } from '../src/index';
import { clear, update } from '../src/intelligence/fleet';

const OUT_DIR = path.resolve(__dirname, '..', 'docs', 'sample-outputs');
fs.mkdirSync(OUT_DIR, { recursive: true });

const cases = [
  { agent: 'agent-healthy', score: 84, band: 'healthy' as const, color: '#3fb950', file: 'badge-healthy.svg' },
  { agent: 'agent-caution', score: 62, band: 'caution' as const, color: '#d29922', file: 'badge-caution.svg' },
  { agent: 'agent-unsafe',  score: 30, band: 'unsafe'  as const, color: '#f85149', file: 'badge-unsafe.svg'  },
];

function looksLikeSvg(s: string): boolean {
  return /^<svg\b[^>]*\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(s) && s.trimEnd().endsWith('</svg>');
}

let passed = 0, failed = 0;
const assert = (n: string, c: boolean, d?: string) => {
  if (c) { passed++; console.log(`  ok  ${n}`); }
  else   { failed++; console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`); }
};

console.log('[1] renderBadge() direct: write 3 SVGs to docs/sample-outputs/');
for (const c of cases) {
  const svg = renderBadge(c.agent, c.score, c.band);
  const out = path.join(OUT_DIR, c.file);
  fs.writeFileSync(out, svg);
  console.log(`   wrote ${out} (${svg.length} chars)`);
  assert(`${c.file}: valid <svg>...</svg> shell`, looksLikeSvg(svg));
  assert(`${c.file}: contains the score`, svg.includes(`>${c.score}<`));
  assert(`${c.file}: contains the "trust" label`, svg.includes('>trust<'));
  assert(`${c.file}: uses the ${c.band} color ${c.color}`, svg.toLowerCase().includes(c.color.toLowerCase()));
  assert(`${c.file}: aria-label mentions trust + agent`, svg.includes(`aria-label="trust: ${c.score} (${c.agent})"`));
}

console.log('\n[2] Watchdog.renderBadge(agentId) looks up fleet registry');
clear();
update('demo-fleet-agent', { trustScore: 47, band: 'unsafe', trend: 'down' });
const svgFromStatic = Watchdog.renderBadge('demo-fleet-agent');
const outStatic = path.join(OUT_DIR, 'badge-from-fleet.svg');
fs.writeFileSync(outStatic, svgFromStatic);
console.log(`   wrote ${outStatic}`);
assert('static renderBadge returns a valid svg', looksLikeSvg(svgFromStatic));
assert('static renderBadge picked up fleet score 47', svgFromStatic.includes('>47<'));
assert('static renderBadge picked up unsafe red', svgFromStatic.toLowerCase().includes('#f85149'));

console.log('\n[3] missing-from-fleet agent → defaults to 100/healthy');
const svgMissing = Watchdog.renderBadge('not-registered');
assert('missing agent renders valid svg', looksLikeSvg(svgMissing));
assert('missing agent defaults score=100', svgMissing.includes('>100<'));
assert('missing agent defaults to healthy green', svgMissing.toLowerCase().includes('#3fb950'));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
