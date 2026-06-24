/**
 * mcp-smoke.ts — drive the WATCHDOG MCP server as a real MCP client over stdio.
 * Proves: list tools, gate good trades, and block an overtrading agent — all
 * through the Model Context Protocol, exactly as another agent would.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path from 'path';

async function main() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(__dirname, '..', 'dist', 'mcp', 'server.js')],
    env: { ...process.env, WATCHDOG_MAX_TRADES_PER_HOUR: '5' },
  });
  const client = new Client({ name: 'smoke-client', version: '1.0.0' });
  await client.connect(transport);

  let pass = 0, fail = 0;
  const check = (n: string, c: boolean) => { if (c) { pass++; console.log('  ok  ' + n); } else { fail++; console.log('  FAIL  ' + n); } };

  // 1. list tools
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  console.log('\n[tools exposed]');
  names.forEach((n) => console.log('   · ' + n));
  check('exposes watchdog_check_trade', names.includes('watchdog_check_trade'));
  check('exposes 9 tools', names.length === 9);

  const callJson = async (name: string, args: Record<string, unknown>) => {
    const r: any = await client.callTool({ name, arguments: args });
    return JSON.parse(r.content[0].text);
  };

  // 2. gate good trades (limit is 5/hr)
  console.log('\n[gating an agent — limit 5 trades/hr]');
  let approved = 0, blocked = 0;
  for (let i = 0; i < 8; i++) {
    const d = await callJson('watchdog_check_trade', {
      agentId: 'mcp-agent', type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long',
    });
    if (d.approved) approved++; else blocked++;
    console.log(`   trade ${i + 1}: ${d.approved ? 'approved' : 'BLOCKED'}  trust=${d.trustScore}${d.reason ? '  · ' + d.reason : ''}`);
  }
  check('approved the first few', approved > 0);
  check('blocked once overtrading (onViolation=pause)', blocked > 0);

  // 3. status reflects the violation
  const status = await callJson('watchdog_get_status', { agentId: 'mcp-agent' });
  check('status shows frequency violation', status.status.metrics.frequency.status === 'violation');
  check('status shows paused', status.status.paused === true);

  // 4. leaderboard includes the agent
  const lb = await callJson('watchdog_get_leaderboard', {});
  check('leaderboard lists the agent', lb.leaderboard.some((p: any) => p.agentId === 'mcp-agent'));

  console.log(`\n${pass} passed, ${fail} failed`);
  await client.close();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
