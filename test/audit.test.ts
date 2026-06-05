import { describe, it, expect } from 'vitest';
import { AuditChain, GENESIS_HASH } from '../src/intelligence/audit';

describe('AuditChain', () => {
  it('empty chain verifies valid', () => {
    const c = new AuditChain();
    expect(c.verify()).toEqual({ valid: true, brokenAt: null });
    expect(c.size()).toBe(0);
    expect(c.getTrail()).toEqual([]);
  });

  it('first entry references genesis hash', () => {
    const c = new AuditChain();
    const e = c.append('decision', { x: 1 });
    expect(e.index).toBe(0);
    expect(e.prevHash).toBe(GENESIS_HASH);
    expect(e.hash).toHaveLength(64);
    expect(c.verify()).toEqual({ valid: true, brokenAt: null });
  });

  it('hashes chain across multiple appends', () => {
    const c = new AuditChain();
    c.append('decision', { a: 1 });
    c.append('trust-update', { b: 2 });
    c.append('violation', { c: 3 });
    const trail = c.getTrail();
    expect(trail[1].prevHash).toBe(trail[0].hash);
    expect(trail[2].prevHash).toBe(trail[1].hash);
    expect(c.verify().valid).toBe(true);
  });

  it('detects payload tampering at the right index', () => {
    const c = new AuditChain();
    c.append('decision', { a: 1 });
    c.append('decision', { a: 2 });
    c.append('decision', { a: 3 });
    const trail = c.getTrail();
    (trail[1].payload as { a: number }).a = 99;
    expect(c.verify()).toEqual({ valid: false, brokenAt: 1 });
  });

  it('detects prevHash tampering', () => {
    const c = new AuditChain();
    c.append('decision', { a: 1 });
    c.append('decision', { a: 2 });
    c.getTrail()[1].prevHash = 'f'.repeat(64);
    expect(c.verify().valid).toBe(false);
    expect(c.verify().brokenAt).toBe(1);
  });

  it('detects hash tampering', () => {
    const c = new AuditChain();
    c.append('decision', { a: 1 });
    c.getTrail()[0].hash = '0'.repeat(64);
    expect(c.verify().valid).toBe(false);
    expect(c.verify().brokenAt).toBe(0);
  });

  it('detects index tampering', () => {
    const c = new AuditChain();
    c.append('decision', { a: 1 });
    c.append('decision', { a: 2 });
    c.getTrail()[1].index = 5;
    expect(c.verify().brokenAt).toBe(1);
  });

  it('clear empties the chain', () => {
    const c = new AuditChain();
    c.append('decision', { a: 1 });
    c.clear();
    expect(c.size()).toBe(0);
    expect(c.verify().valid).toBe(true);
  });
});
