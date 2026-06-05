import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Watchdog, WatchdogConfig } from '../src/index';
import { clear, getLeaderboard } from '../src/intelligence/fleet';

function mkCfg(over: Partial<WatchdogConfig> = {}): WatchdogConfig {
  return {
    agentId: 'wd-extras',
    portfolioUsdt: 10_000,
    rules: {
      maxTradesPerHour: 3,
      maxPositionSizePercent: 25,
      maxDrawdownPercent: 10,
      maxConsecutiveLosses: 3,
      maxSignalOverridesPerHour: 3,
    },
    onViolation: 'alert',
    ...over,
  };
}

beforeEach(() => clear());

describe('Watchdog — extra branches', () => {
  it('onViolation:alert returns reason but approves=true', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = new Watchdog(mkCfg());
    for (let i = 0; i < 4; i++) await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    expect(d.approved).toBe(true);
    expect(d.action).toBe('alert');
    expect(d.reason).toMatch(/frequency/);
    warn.mockRestore();
  });

  it('fleet registration ticks totalTrades and incidents', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = new Watchdog(mkCfg({ fleet: { register: true } }));
    for (let i = 0; i < 5; i++) await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    const p = getLeaderboard().find((x) => x.agentId === 'wd-extras')!;
    expect(p.totalTrades).toBe(5);
    expect(p.incidents).toBeGreaterThanOrEqual(1);
    warn.mockRestore();
  });

  it('flushDiagnosis returns null when no AI configured', async () => {
    const w = new Watchdog(mkCfg());
    const d = await w.flushDiagnosis();
    expect(d).toBeNull();
  });

  it('Watchdog.renderBadge for unregistered agent defaults to 100/healthy/green', () => {
    const svg = Watchdog.renderBadge('not-a-real-agent');
    expect(svg).toContain('>100<');
    expect(svg.toLowerCase()).toContain('#3fb950');
  });

  it('static getLeaderboard returns [] when fleet is empty', () => {
    expect(Watchdog.getLeaderboard()).toEqual([]);
  });

  it('reset emits a reset event', () => {
    const w = new Watchdog(mkCfg());
    w.reset();
    expect(w.getEvents().map((e) => e.type)).toContain('reset');
  });
});
