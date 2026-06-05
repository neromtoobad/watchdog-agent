import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateDiagnosis } from '../src/intelligence/diagnosis';
import type { MetricResult } from '../src/index';

const metricStates: MetricResult[] = [
  { name: 'frequency', status: 'violation', value: 12, threshold: 10, detail: 'too many' },
  { name: 'positionDrift', status: 'ok', value: 5, threshold: 25, detail: '' },
  { name: 'drawdown', status: 'warning', value: 8, threshold: 10, detail: '' },
  { name: 'lossStreak', status: 'ok', value: 0, threshold: 4, detail: '' },
  { name: 'signalOverride', status: 'ok', value: 0, threshold: 3, detail: '' },
];

let origKey: string | undefined;
let origModel: string | undefined;

beforeEach(() => {
  origKey = process.env.WATCHDOG_AI_API_KEY;
  origModel = process.env.WATCHDOG_AI_MODEL;
  delete process.env.WATCHDOG_AI_API_KEY;
  delete process.env.WATCHDOG_AI_MODEL;
});

afterEach(() => {
  if (origKey) process.env.WATCHDOG_AI_API_KEY = origKey; else delete process.env.WATCHDOG_AI_API_KEY;
  if (origModel) process.env.WATCHDOG_AI_MODEL = origModel; else delete process.env.WATCHDOG_AI_MODEL;
});

describe('generateDiagnosis — fallback path (no AI configured)', () => {
  it('returns a templated diagnosis with source=fallback', async () => {
    const d = await generateDiagnosis({
      agentId: 'fallback-test',
      recentEvents: [],
      metricStates,
      marketContext: null,
    });
    expect(d.source).toBe('fallback');
    expect(d.summary).toMatch(/fallback-test/);
    expect(d.summary).toMatch(/frequency/);
    expect(d.likelyCause).toBeTruthy();
    expect(d.recommendation).toBeTruthy();
    expect(d.timestamp).toBeGreaterThan(0);
  });

  it('mentions the violating metric in the summary', async () => {
    const d = await generateDiagnosis({
      agentId: 'a',
      recentEvents: [],
      metricStates,
      marketContext: null,
    });
    expect(d.summary).toContain('12');
  });

  it('falls back to warning metric if no violation', async () => {
    const only = metricStates.map((m) => m.name === 'frequency' ? { ...m, status: 'ok' as const } : m);
    const d = await generateDiagnosis({
      agentId: 'a',
      recentEvents: [],
      metricStates: only,
      marketContext: null,
    });
    expect(d.summary).toMatch(/drawdown/);
  });

  it('includes metricStates + marketContext in context', async () => {
    const d = await generateDiagnosis({
      agentId: 'a',
      recentEvents: [],
      metricStates,
      marketContext: null,
    });
    expect(Array.isArray((d.context as any).metricStates)).toBe(true);
    expect((d.context as any).marketContext).toBeNull();
  });
});

describe('generateDiagnosis — error path', () => {
  it('returns fallback when api errors (bad key)', async () => {
    const d = await generateDiagnosis({
      agentId: 'a',
      recentEvents: [],
      metricStates,
      marketContext: null,
      apiKey: 'invalid-key-xxx',
      model: 'claude-sonnet-4-6',
    });
    expect(d.source).toBe('fallback');
    expect((d.context as any).aiError).toBeTruthy();
  }, 20_000);
});
