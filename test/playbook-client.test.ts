import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { _internal, _setHttpsRequest, _resetHttpsRequest, dispatchRun, pollRun, runPlaybook } from '../src/playbook/client';

describe('isTransient classifier', () => {
  it('treats 5xx as transient', () => {
    expect(_internal.isTransient(500)).toBe(true);
    expect(_internal.isTransient(502)).toBe(true);
    expect(_internal.isTransient(503)).toBe(true);
    expect(_internal.isTransient(504)).toBe(true);
  });
  it('treats 4xx as fatal (not transient)', () => {
    expect(_internal.isTransient(400)).toBe(false);
    expect(_internal.isTransient(401)).toBe(false);
    expect(_internal.isTransient(403)).toBe(false);
    expect(_internal.isTransient(404)).toBe(false);
  });
  it('treats 2xx as not transient (success)', () => {
    expect(_internal.isTransient(200)).toBe(false);
  });
  it('treats network resets / timeouts as transient', () => {
    expect(_internal.isTransient(undefined, 'ECONNRESET')).toBe(true);
    expect(_internal.isTransient(undefined, 'ETIMEDOUT')).toBe(true);
    expect(_internal.isTransient(undefined, 'EAI_AGAIN')).toBe(true);
    expect(_internal.isTransient(undefined, 'bitget request timeout')).toBe(true);
  });
  it('treats unknown errors as not transient', () => {
    expect(_internal.isTransient(undefined, 'ENOTFOUND')).toBe(false);
    expect(_internal.isTransient(undefined, 'ECONNREFUSED')).toBe(false);
  });
});

// ── local HTTP server that scripts a sequence of responses ─────────────
interface Step { status: number; body: string; }
let server: http.Server;
let port: number;
let plan: Step[] = [];
let received: { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ method: req.method ?? '?', url: req.url ?? '?', headers: req.headers, body });
      const step = plan.shift();
      if (!step) { res.writeHead(500); res.end('plan exhausted'); return; }
      res.writeHead(step.status, { 'content-type': 'application/json' });
      res.end(step.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

// Point the client's https.request at our local plain-HTTP server.
beforeAll(() => {
  _setHttpsRequest(((options: any, cb?: any) => {
    return http.request({ ...options, hostname: '127.0.0.1', port }, cb);
  }) as any);
});

afterAll(() => { _resetHttpsRequest(); });

describe('dispatchRun + pollRun with retry', () => {
  beforeAll(() => { received = []; });

  it('returns immediately on a clean 200', async () => {
    plan = [{ status: 200, body: JSON.stringify({ run_id: 'r1', status: 'pending' }) }];
    received = [];
    const r = await dispatchRun({ versionId: 'v1', accessKey: 'k', silent: true });
    expect(r.run_id).toBe('r1');
    expect(received.length).toBe(1);
    expect(received[0].method).toBe('POST');
    expect(received[0].headers['access-key']).toBe('k');
  });

  it('retries through 502s and succeeds', async () => {
    plan = [
      { status: 502, body: 'error code: 502' },
      { status: 502, body: 'error code: 502' },
      { status: 200, body: JSON.stringify({ run_id: 'r2', status: 'pending' }) },
    ];
    received = [];
    const r = await dispatchRun({ versionId: 'v1', accessKey: 'k', silent: true, maxRetries: 4 });
    expect(r.run_id).toBe('r2');
    expect(received.length).toBe(3);
  });

  it('gives up after exhausting retries on persistent 502', async () => {
    plan = Array.from({ length: 10 }, () => ({ status: 502, body: 'error code: 502' }));
    received = [];
    await expect(dispatchRun({ versionId: 'v1', accessKey: 'k', silent: true, maxRetries: 2 }))
      .rejects.toThrow(/502.*after 3 attempts/);
    expect(received.length).toBe(3);
  });

  it('does NOT retry on 4xx — fails fast', async () => {
    plan = [{ status: 404, body: '{"code":"404000","msg":"not found"}' }];
    received = [];
    await expect(dispatchRun({ versionId: 'v1', accessKey: 'k', silent: true })).rejects.toThrow(/404/);
    expect(received.length).toBe(1);
  });

  it('pollRun retries on 502 too', async () => {
    plan = [
      { status: 503, body: 'try again' },
      { status: 200, body: JSON.stringify({ run_id: 'p1', status: 'completed', signal_output: [], metrics_output: {} }) },
    ];
    received = [];
    const r = await pollRun('p1', { versionId: '', accessKey: 'k', silent: true });
    expect(r.status).toBe('completed');
    expect(received.length).toBe(2);
  });
});

describe('runPlaybook orchestration', () => {
  it('dispatches then polls until completed', async () => {
    plan = [
      { status: 200, body: JSON.stringify({ run_id: 'r3', status: 'pending' }) },       // dispatch
      { status: 200, body: JSON.stringify({ run_id: 'r3', status: 'running' }) },      // poll 1
      { status: 200, body: JSON.stringify({ run_id: 'r3', status: 'completed', signal_output: [], metrics_output: { total_return_pct: 5 } }) }, // poll 2
    ];
    received = [];
    const r = await runPlaybook({ versionId: 'v1', accessKey: 'k', silent: true, pollIntervalMs: 50 });
    expect(r.status).toBe('completed');
    expect(r.metrics_output?.total_return_pct).toBe(5);
  });

  it('throws if the run reports failed', async () => {
    plan = [
      { status: 200, body: JSON.stringify({ run_id: 'rf', status: 'pending' }) },
      { status: 200, body: JSON.stringify({ run_id: 'rf', status: 'failed', failure_reason: 'sandbox OOM' }) },
    ];
    received = [];
    await expect(runPlaybook({ versionId: 'v1', accessKey: 'k', silent: true, pollIntervalMs: 50 }))
      .rejects.toThrow(/sandbox OOM/);
  });
});
