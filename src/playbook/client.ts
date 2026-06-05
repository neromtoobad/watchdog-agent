/**
 * Bitget GetAgent Playbook HTTP client.
 *
 * Mirrors `POST /api/v1/playbook/run` (dispatch) + `GET /api/v1/playbook/run?run_id=...`
 * (poll until completed). Authenticated via the `ACCESS-KEY` header, per the
 * getagent-skill API reference.
 *
 * Transient failures (5xx, network resets, timeouts) are retried with
 * exponential backoff. Real 4xx errors fail fast.
 *
 * Use:
 *   const run = await runPlaybook({ versionId, accessKey });
 *   // run is a completed PlaybookRunResponse
 */
import * as https from 'https';
import type { PlaybookRunResponse } from './types';

const HOST = 'api.bitget.com';
const RUN_PATH = '/api/v1/playbook/run';
const POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 240_000; // backtests cap at 180s server-side; 240s wall is generous
const REQUEST_TIMEOUT_MS = 30_000;

// retry knobs — Bitget's edge throws transient 5xx + ECONNRESETs fairly often
const DEFAULT_MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 1_000; // 1s, 2s, 4s, 8s

export interface RunPlaybookOptions {
  versionId: string;
  accessKey: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  /** override host for testing */
  host?: string;
  /** silence retry warnings (default: log to stderr) */
  silent?: boolean;
}

type RawResult = { status: number; body: string };

// Test seam: tests can replace the underlying request implementation
// without monkey-patching the immutable https module export.
let httpsRequestImpl: typeof https.request = https.request;
export function _setHttpsRequest(fn: typeof https.request): void { httpsRequestImpl = fn; }
export function _resetHttpsRequest(): void { httpsRequestImpl = https.request; }

function rawRequest(
  method: 'GET' | 'POST',
  host: string,
  path: string,
  accessKey: string,
  body?: object,
): Promise<RawResult> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = httpsRequestImpl(
      {
        method,
        hostname: host,
        path,
        headers: {
          'content-type': 'application/json',
          'ACCESS-KEY': accessKey,
          ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('bitget request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

const TRANSIENT_NET_CODES = new Set([
  'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH', 'EPIPE',
]);

function isTransient(status?: number, errCode?: string): boolean {
  if (errCode && TRANSIENT_NET_CODES.has(errCode)) return true;
  if (errCode === 'bitget request timeout' || errCode === 'timeout') return true;
  if (status !== undefined && status >= 500 && status < 600) return true;
  return false;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** request() wraps rawRequest() with retry on transient failures. */
async function request(
  method: 'GET' | 'POST',
  host: string,
  path: string,
  accessKey: string,
  body: object | undefined,
  maxRetries: number,
  silent: boolean,
): Promise<RawResult> {
  let lastErr: Error | null = null;
  let lastStatus: number | undefined;
  let lastBody = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
      if (!silent) {
        const reason = lastErr ? `${(lastErr as NodeJS.ErrnoException).code || lastErr.message}` : `HTTP ${lastStatus}`;
        console.warn(`[playbook-client] retry ${attempt}/${maxRetries} after ${backoff}ms (${method} ${path} ← ${reason})`);
      }
      await wait(backoff);
    }
    try {
      const res = await rawRequest(method, host, path, accessKey, body);
      lastStatus = res.status;
      lastBody = res.body;
      if (isTransient(res.status)) continue;
      return res;
    } catch (e) {
      lastErr = e as Error;
      const code = (e as NodeJS.ErrnoException).code;
      if (!isTransient(undefined, code || (e as Error).message)) throw e;
    }
  }

  // exhausted retries
  if (lastErr) throw new Error(`${method} ${path} failed after ${maxRetries + 1} attempts: ${(lastErr as NodeJS.ErrnoException).code || lastErr.message}`);
  throw new Error(`${method} ${path} → ${lastStatus} after ${maxRetries + 1} attempts: ${lastBody.slice(0, 300)}`);
}

export async function dispatchRun(opts: RunPlaybookOptions): Promise<PlaybookRunResponse> {
  const host = opts.host ?? HOST;
  const retries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const res = await request('POST', host, RUN_PATH, opts.accessKey, { version_id: opts.versionId }, retries, !!opts.silent);
  if (res.status >= 400) throw new Error(`POST ${RUN_PATH} → ${res.status}: ${res.body}`);
  return JSON.parse(res.body) as PlaybookRunResponse;
}

export async function pollRun(runId: string, opts: RunPlaybookOptions): Promise<PlaybookRunResponse> {
  const host = opts.host ?? HOST;
  const retries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const res = await request('GET', host, `${RUN_PATH}?run_id=${encodeURIComponent(runId)}`, opts.accessKey, undefined, retries, !!opts.silent);
  if (res.status >= 400) throw new Error(`GET ${RUN_PATH} → ${res.status}: ${res.body}`);
  return JSON.parse(res.body) as PlaybookRunResponse;
}

export async function runPlaybook(opts: RunPlaybookOptions): Promise<PlaybookRunResponse> {
  const dispatched = await dispatchRun(opts);
  const runId = dispatched.run_id;
  const pollMs = opts.pollIntervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const r = await pollRun(runId, opts);
    if (r.status === 'completed') return r;
    if (r.status === 'failed') {
      throw new Error(`playbook run ${runId} failed: ${r.failure_reason || 'no reason given'}`);
    }
    await wait(pollMs);
  }
  throw new Error(`playbook run ${runId} did not complete within ${timeoutMs}ms`);
}

// exported for tests
export const _internal = { isTransient, rawRequest };
