import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Watchdog, WatchdogConfig } from '../src/index';
import { clear } from '../src/intelligence/fleet';

function mkCfg(over: Partial<WatchdogConfig> = {}): WatchdogConfig {
  return {
    agentId: 'wd-test',
    portfolioUsdt: 10_000,
    rules: {
      maxTradesPerHour: 5,
      maxPositionSizePercent: 25,
      maxDrawdownPercent: 10,
      maxConsecutiveLosses: 3,
      maxSignalOverridesPerHour: 3,
    },
    onViolation: 'log',
    ...over,
  };
}

beforeEach(() => clear());

describe('Watchdog — integration', () => {
  it('checkTrade approves a fresh trade and carries trustScore', async () => {
    const w = new Watchdog(mkCfg());
    const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    expect(d.approved).toBe(true);
    expect(typeof d.trustScore).toBe('number');
    expect(d.action).toBeNull();
  });

  it('reportTradeClosed and reportSignal record events', () => {
    const w = new Watchdog(mkCfg());
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -10 });
    w.reportSignal({ signal: 'bullish', action: 'open-long' });
    const types = w.getEvents().map((e) => e.type);
    expect(types).toContain('trade-close');
    expect(types).toContain('signal');
  });

  it('getStatus exposes the 5 metrics keyed by name', async () => {
    const w = new Watchdog(mkCfg());
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    const s = w.getStatus();
    expect(Object.keys(s.metrics).sort()).toEqual(['drawdown', 'frequency', 'lossStreak', 'positionDrift', 'signalOverride']);
    expect(s.agentId).toBe('wd-test');
    expect(s.paused).toBe(false);
  });

  it('onViolation:pause blocks subsequent checkTrade', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = new Watchdog(mkCfg({ onViolation: 'pause' }));
    let blocked = 0;
    for (let i = 0; i < 10; i++) {
      const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
      if (!d.approved) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
    expect(w.getStatus().paused).toBe(true);
    warn.mockRestore();
  });

  it('onViolation:log records the violation but never blocks', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = new Watchdog(mkCfg());
    for (let i = 0; i < 10; i++) {
      const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
      expect(d.approved).toBe(true);
    }
    expect(w.getStatus().paused).toBe(false);
    warn.mockRestore();
  });

  it('reset clears events, paused, trust, audit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = new Watchdog(mkCfg({ onViolation: 'pause' }));
    for (let i = 0; i < 10; i++) await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    expect(w.getStatus().paused).toBe(true);
    w.reset();
    expect(w.getStatus().paused).toBe(false);
    expect(w.getTrustScore().score).toBe(100);
    expect(w.getAuditTrail().length).toBe(0);
    warn.mockRestore();
  });

  it('audit chain verifies after a real sequence', async () => {
    const w = new Watchdog(mkCfg());
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: -10 });
    expect(w.verifyAuditChain().valid).toBe(true);
  });

  it('static getLeaderboard returns fleet profiles when registered', async () => {
    const w = new Watchdog(mkCfg({ fleet: { register: true } }));
    await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    const board = Watchdog.getLeaderboard();
    expect(board.some((p) => p.agentId === 'wd-test')).toBe(true);
  });

  it('static renderBadge returns an SVG', () => {
    const svg = Watchdog.renderBadge('any-agent');
    expect(svg.startsWith('<svg')).toBe(true);
  });

  it('getEvents caps at 50', async () => {
    const w = new Watchdog(mkCfg());
    for (let i = 0; i < 80; i++) w.reportTradeClosed({ symbol: 'BTCUSDT', pnlUsdt: 1 });
    expect(w.getEvents().length).toBeLessThanOrEqual(50);
  });

  it('paused state returns deterministic decision shape', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = new Watchdog(mkCfg({ onViolation: 'pause' }));
    for (let i = 0; i < 10; i++) await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    const d = await w.checkTrade({ type: 'open', symbol: 'BTCUSDT', sizeUsdt: 100, direction: 'long' });
    expect(d.approved).toBe(false);
    expect(d.action).toBe('pause');
    expect(d.reason).toMatch(/paused/);
    warn.mockRestore();
  });
});
