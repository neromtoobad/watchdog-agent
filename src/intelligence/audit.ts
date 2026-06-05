import { createHash } from 'node:crypto';
import type { AuditEntry, EventType } from '../index';

export const GENESIS_HASH = '0'.repeat(64);

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function hashFor(prevHash: string, data: unknown, timestamp: number): string {
  return sha256(prevHash + JSON.stringify(data) + String(timestamp));
}

export class AuditChain {
  private chain: AuditEntry[] = [];

  append(type: EventType, data: Record<string, unknown>): AuditEntry {
    const timestamp = Date.now();
    const index = this.chain.length;
    const prevHash = index === 0 ? GENESIS_HASH : this.chain[index - 1].hash;
    const hash = hashFor(prevHash, data, timestamp);
    const entry: AuditEntry = { index, timestamp, type, payload: data, prevHash, hash };
    this.chain.push(entry);
    return entry;
  }

  /**
   * Returns the live chain reference — exposed read/tamper for the
   * audit trail's verifiability story. Callers may inspect entries
   * directly; verify() recomputes hashes against whatever it sees.
   */
  getTrail(): AuditEntry[] {
    return this.chain;
  }

  size(): number {
    return this.chain.length;
  }

  clear(): void {
    this.chain = [];
  }

  verify(): { valid: boolean; brokenAt: number | null } {
    for (let i = 0; i < this.chain.length; i++) {
      const e = this.chain[i];
      if (e.index !== i) return { valid: false, brokenAt: i };
      const expectedPrev = i === 0 ? GENESIS_HASH : this.chain[i - 1].hash;
      if (e.prevHash !== expectedPrev) return { valid: false, brokenAt: i };
      const expectedHash = hashFor(e.prevHash, e.payload, e.timestamp);
      if (e.hash !== expectedHash) return { valid: false, brokenAt: i };
    }
    return { valid: true, brokenAt: null };
  }
}
