import { describe, it, expect, afterEach } from 'vitest';
import * as http from 'http';
import { callLLM, resolveProvider, _setHttpsRequest, _resetHttpsRequest } from '../src/intelligence/llm';

describe('resolveProvider', () => {
  it('routes claude → anthropic', () => {
    expect(resolveProvider('claude-sonnet-4-6')).toBe('anthropic');
  });
  it('routes qwen → openai-compatible', () => {
    expect(resolveProvider('qwen-plus')).toBe('openai');
    expect(resolveProvider('qwen-max')).toBe('openai');
  });
  it('routes gpt / deepseek / glm → openai-compatible', () => {
    expect(resolveProvider('gpt-4o')).toBe('openai');
    expect(resolveProvider('deepseek-chat')).toBe('openai');
    expect(resolveProvider('glm-4')).toBe('openai');
  });
  it('explicit override wins', () => {
    expect(resolveProvider('qwen-plus', 'anthropic')).toBe('anthropic');
  });
  it('unknown model defaults to anthropic', () => {
    expect(resolveProvider('mystery-model')).toBe('anthropic');
  });
});

// stub the network: a local server that captures the request and replies
function withStubServer(handler: (req: http.IncomingMessage, body: string) => { status: number; json: unknown }) {
  return new Promise<{ captured: { url: string; headers: http.IncomingHttpHeaders; body: string }[] }>((resolve) => {
    const captured: { url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        captured.push({ url: req.url ?? '', headers: req.headers, body });
        const { status, json } = handler(req, body);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as import('net').AddressInfo).port;
      // route https.request to this http server
      _setHttpsRequest(((opts: any, cb?: any) => http.request({ ...opts, hostname: '127.0.0.1', port }, cb)) as any);
      resolve({ captured });
      void server; // kept alive until process tick; fine for these short tests
    });
  });
}

afterEach(() => _resetHttpsRequest());

describe('callLLM wire protocols', () => {
  it('uses Anthropic shape for claude models', async () => {
    const { captured } = await withStubServer(() => ({
      status: 200,
      json: { content: [{ type: 'text', text: 'claude says hi' }] },
    }));
    const text = await callLLM({ system: 'sys', user: 'hi', apiKey: 'k', model: 'claude-sonnet-4-6' });
    expect(text).toBe('claude says hi');
    expect(captured[0].url).toBe('/v1/messages');
    expect(captured[0].headers['x-api-key']).toBe('k');
    expect(captured[0].headers['anthropic-version']).toBeTruthy();
    const sent = JSON.parse(captured[0].body);
    expect(sent.system).toBe('sys');
    expect(sent.messages[0].content).toBe('hi');
  });

  it('uses OpenAI-compatible shape + Bearer auth for qwen models', async () => {
    const { captured } = await withStubServer(() => ({
      status: 200,
      json: { choices: [{ message: { content: 'qwen says hi' } }] },
    }));
    const text = await callLLM({ system: 'sys', user: 'hi', apiKey: 'k', model: 'qwen-plus' });
    expect(text).toBe('qwen says hi');
    expect(captured[0].url).toContain('/chat/completions');
    expect(captured[0].headers['authorization']).toBe('Bearer k');
    const sent = JSON.parse(captured[0].body);
    expect(sent.messages[0].role).toBe('system');
    expect(sent.messages[1].role).toBe('user');
  });

  it('throws (so callers fall back) on HTTP error', async () => {
    await withStubServer(() => ({ status: 401, json: { error: 'nope' } }));
    await expect(callLLM({ system: 's', user: 'u', apiKey: 'bad', model: 'qwen-plus' })).rejects.toThrow();
  });

  it('throws when no key/model configured', async () => {
    await expect(callLLM({ system: 's', user: 'u', apiKey: '', model: '' })).rejects.toThrow(/no apiKey\/model/);
  });
});
