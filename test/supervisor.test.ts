import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reviewFleet, askSupervisor, FleetSnapshot } from '../src/intelligence/supervisor';

// force the heuristic (offline) path: ensure no key is present
let origKey: string | undefined, origModel: string | undefined;
beforeEach(() => {
  origKey = process.env.WATCHDOG_AI_API_KEY; origModel = process.env.WATCHDOG_AI_MODEL;
  delete process.env.WATCHDOG_AI_API_KEY; delete process.env.WATCHDOG_AI_MODEL;
});
afterEach(() => {
  if (origKey) process.env.WATCHDOG_AI_API_KEY = origKey;
  if (origModel) process.env.WATCHDOG_AI_MODEL = origModel;
});

function agent(id: string, trust: number, band: string, over: Partial<FleetSnapshot['agents'][0]> = {}): FleetSnapshot['agents'][0] {
  return {
    agentId: id, trustScore: trust, band, trend: 'flat', paused: band === 'unsafe',
    metrics: [{ name: 'frequency', status: 'ok', value: 4, threshold: 10 }],
    baselines: [], forecasts: [], recentEvents: [], ...over,
  };
}

describe('supervisor — heuristic review (offline)', () => {
  it('returns heuristic source with no API key', async () => {
    const r = await reviewFleet({ agents: [agent('a', 100, 'healthy')] });
    expect(r.source).toBe('heuristic');
    expect(r.timestamp).toBeGreaterThan(0);
  });

  it('names the lowest-trust agent as top risk', async () => {
    const r = await reviewFleet({ agents: [
      agent('alpha', 95, 'healthy'),
      agent('bravo', 41, 'unsafe'),
      agent('charlie', 70, 'caution'),
    ] });
    expect(r.topRisk?.agentId).toBe('bravo');
  });

  it('surfaces a σ-baseline anomaly as an early warning BEFORE a hard violation', async () => {
    const r = await reviewFleet({ agents: [
      agent('alpha', 82, 'healthy', {
        metrics: [{ name: 'positionDrift', status: 'ok', value: 18, threshold: 25 }], // still OK on the hard rule
        baselines: [{ metric: 'positionDrift', samples: 20, mean: 8, std: 2, current: 18, sigma: 5, anomaly: true }],
      }),
    ] });
    const w = r.earlyWarnings.find((x) => x.agentId === 'alpha');
    expect(w).toBeTruthy();
    expect(w!.signal).toMatch(/positionDrift/);
  });

  it('surfaces a forecast as an early warning', async () => {
    const r = await reviewFleet({ agents: [
      agent('alpha', 88, 'healthy', { forecasts: [{ metric: 'drawdown', breachInTrades: 3 }] }),
    ] });
    expect(r.earlyWarnings.some((w) => /drawdown/.test(w.signal) && /3/.test(w.signal))).toBe(true);
  });

  it('flags correlated fleet failure when 2+ agents are unsafe', async () => {
    const r = await reviewFleet({ agents: [
      agent('a', 30, 'unsafe'), agent('b', 35, 'unsafe'), agent('c', 90, 'healthy'),
    ] });
    expect(r.fleetAssessment).toMatch(/shared market event|correlated/i);
  });

  it('reports a calm fleet when mostly healthy', async () => {
    const r = await reviewFleet({ agents: [agent('a', 95, 'healthy'), agent('b', 88, 'healthy')] });
    expect(r.fleetAssessment).toMatch(/stable|healthy/i);
  });

  it('empty fleet → heuristic, no topRisk', async () => {
    const r = await reviewFleet({ agents: [] });
    expect(r.source).toBe('heuristic');
    expect(r.topRisk).toBeNull();
  });
});

describe('supervisor — ask (offline)', () => {
  it('answers a question from the snapshot heuristically', async () => {
    const ans = await askSupervisor('which agent is most at risk?', { agents: [
      agent('alpha', 95, 'healthy'), agent('bravo', 41, 'unsafe'),
    ] });
    expect(ans.source).toBe('heuristic');
    expect(ans.answer).toMatch(/bravo/);
  });
});
