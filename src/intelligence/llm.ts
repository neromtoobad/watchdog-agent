/**
 * Model-agnostic LLM client for WATCHDOG's AI layers (diagnosis + supervisor).
 *
 * Supports two wire protocols:
 *   - Anthropic Messages API   (Claude)              → api.anthropic.com/v1/messages
 *   - OpenAI-compatible chat    (Qwen / DashScope,    → {baseUrl}/chat/completions
 *     OpenAI, DeepSeek, etc.)
 *
 * Provider is auto-detected from the model name, or forced via
 * WATCHDOG_AI_PROVIDER. Base URL can be overridden via WATCHDOG_AI_BASE_URL.
 *
 * Env:
 *   WATCHDOG_AI_API_KEY    required to use any real model
 *   WATCHDOG_AI_MODEL      e.g. claude-sonnet-4-6 | qwen-plus | qwen-max
 *   WATCHDOG_AI_PROVIDER   optional: 'anthropic' | 'openai'
 *   WATCHDOG_AI_BASE_URL   optional: override the OpenAI-compatible base URL
 *
 * Qwen example (.env):
 *   WATCHDOG_AI_API_KEY=sk-...                       # DashScope key
 *   WATCHDOG_AI_MODEL=qwen-plus
 *   # base URL defaults to DashScope international compatible-mode; override with:
 *   # WATCHDOG_AI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
 */
import * as https from 'https';

export type LLMProvider = 'anthropic' | 'openai';

export interface LLMRequest {
  system: string;
  user: string;
  apiKey?: string;
  model?: string;
  provider?: LLMProvider;
  baseUrl?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

const DASHSCOPE_INTL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

/** Pick the wire protocol from the model name (or an explicit override / env). */
export function resolveProvider(model?: string, explicit?: LLMProvider): LLMProvider {
  if (explicit) return explicit;
  const env = process.env.WATCHDOG_AI_PROVIDER as LLMProvider | undefined;
  if (env === 'anthropic' || env === 'openai') return env;
  const m = (model || '').toLowerCase();
  if (m.startsWith('claude')) return 'anthropic';
  if (m.startsWith('qwen') || m.startsWith('gpt') || m.startsWith('deepseek') || m.startsWith('glm') || m.startsWith('o1') || m.startsWith('o3')) return 'openai';
  return 'anthropic';
}

/** Test seam: lets tests stub the network layer. */
let httpsRequestImpl: typeof https.request = https.request;
export function _setHttpsRequest(fn: typeof https.request): void { httpsRequestImpl = fn; }
export function _resetHttpsRequest(): void { httpsRequestImpl = https.request; }

function postJson(url: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequestImpl(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('llm request timeout')));
    req.write(body);
    req.end();
  });
}

/**
 * Call the configured LLM and return the assistant's text. Throws on any
 * error (missing key/model, HTTP error, unparseable response) so callers can
 * fall back to their templated/heuristic path.
 */
export async function callLLM(req: LLMRequest): Promise<string> {
  const apiKey = req.apiKey ?? process.env.WATCHDOG_AI_API_KEY;
  const model = req.model ?? process.env.WATCHDOG_AI_MODEL;
  if (!apiKey || !model) throw new Error('llm: no apiKey/model configured');

  const provider = resolveProvider(model, req.provider);
  const maxTokens = req.maxTokens ?? 700;
  const timeoutMs = req.timeoutMs ?? 15_000;

  if (provider === 'anthropic') {
    const body = JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: req.system,
      messages: [{ role: 'user', content: req.user }],
    });
    const res = await postJson('https://api.anthropic.com/v1/messages', {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }, body, timeoutMs);
    if (res.status >= 400) throw new Error(`anthropic ${res.status}: ${res.body.slice(0, 300)}`);
    const parsed = JSON.parse(res.body) as { content?: { type: string; text: string }[] };
    const text = parsed.content?.find((c) => c.type === 'text')?.text ?? '';
    if (!text) throw new Error('anthropic: empty response');
    return text;
  }

  // OpenAI-compatible (Qwen / DashScope / OpenAI / DeepSeek …)
  const base = (req.baseUrl ?? process.env.WATCHDOG_AI_BASE_URL ?? DASHSCOPE_INTL).replace(/\/$/, '');
  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
  });
  const res = await postJson(`${base}/chat/completions`, {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  }, body, timeoutMs);
  if (res.status >= 400) throw new Error(`openai-compatible ${res.status}: ${res.body.slice(0, 300)}`);
  const parsed = JSON.parse(res.body) as { choices?: { message?: { content?: string } }[] };
  const text = parsed.choices?.[0]?.message?.content ?? '';
  if (!text) throw new Error('openai-compatible: empty response');
  return text;
}

/** Human-readable label of what's configured, for status surfaces. */
export function activeModelLabel(): string {
  const model = process.env.WATCHDOG_AI_MODEL;
  if (!process.env.WATCHDOG_AI_API_KEY || !model) return 'none (heuristic/templated fallback)';
  return `${model} (${resolveProvider(model)})`;
}
