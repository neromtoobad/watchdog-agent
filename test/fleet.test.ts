import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import { register, update, getLeaderboard, clear, FLEET_PATH } from '../src/intelligence/fleet';

describe('fleet registry', () => {
  beforeEach(() => clear());

  it('starts empty after clear', () => {
    expect(getLeaderboard()).toEqual([]);
  });

  it('register adds a profile with defaults', () => {
    const p = register('agent-1');
    expect(p.agentId).toBe('agent-1');
    expect(p.trustScore).toBe(100);
    expect(p.band).toBe('healthy');
    expect(p.totalTrades).toBe(0);
    expect(p.incidents).toBe(0);
    expect(p.regimesSurvived).toBe(0);
  });

  it('register is idempotent', () => {
    register('agent-1');
    update('agent-1', { trustScore: 50 });
    register('agent-1'); // should not reset
    expect(getLeaderboard()[0].trustScore).toBe(50);
  });

  it('update merges partial fields and stamps updatedAt', () => {
    register('agent-1');
    const before = getLeaderboard()[0].updatedAt;
    // ensure clock ticks
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    return sleep(5).then(() => {
      const p = update('agent-1', { trustScore: 60, band: 'caution' });
      expect(p.trustScore).toBe(60);
      expect(p.band).toBe('caution');
      expect(p.totalTrades).toBe(0);
      expect(p.updatedAt).toBeGreaterThan(before);
    });
  });

  it('update auto-creates a profile if not registered', () => {
    update('phantom', { trustScore: 73 });
    const board = getLeaderboard();
    expect(board[0].agentId).toBe('phantom');
    expect(board[0].trustScore).toBe(73);
  });

  it('agentId is not overridable via update', () => {
    register('agent-1');
    update('agent-1', { agentId: 'pwned' } as any);
    expect(getLeaderboard()[0].agentId).toBe('agent-1');
  });

  it('getLeaderboard ranks by trustScore desc', () => {
    update('a', { trustScore: 30 });
    update('b', { trustScore: 90 });
    update('c', { trustScore: 60 });
    const board = getLeaderboard();
    expect(board.map((p) => p.agentId)).toEqual(['b', 'c', 'a']);
  });

  it('persists to fleet.local.json', () => {
    update('persist-me', { trustScore: 77 });
    expect(fs.existsSync(FLEET_PATH)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(FLEET_PATH, 'utf8'));
    expect(Array.isArray(onDisk)).toBe(true);
    expect(onDisk.some((p: any) => p.agentId === 'persist-me')).toBe(true);
  });
});
