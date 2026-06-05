import * as fs from 'fs';
import * as path from 'path';
import type { FleetProfile } from '../index';

const FLEET_FILE = path.resolve(process.cwd(), 'fleet.local.json');

const registry = new Map<string, FleetProfile>();
let loaded = false;

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(FLEET_FILE)) {
      const raw = fs.readFileSync(FLEET_FILE, 'utf8');
      const arr = JSON.parse(raw) as FleetProfile[];
      if (Array.isArray(arr)) {
        for (const p of arr) {
          if (p && typeof p.agentId === 'string') registry.set(p.agentId, p);
        }
      }
    }
  } catch {
    // start clean on corrupt file
  }
}

function persist(): void {
  try {
    const arr = Array.from(registry.values());
    fs.writeFileSync(FLEET_FILE, JSON.stringify(arr, null, 2));
  } catch {
    // best-effort
  }
}

function emptyProfile(agentId: string): FleetProfile {
  return {
    agentId,
    trustScore: 100,
    band: 'healthy',
    trend: 'flat',
    totalTrades: 0,
    regimesSurvived: 0,
    incidents: 0,
    updatedAt: Date.now(),
  };
}

export function register(agentId: string): FleetProfile {
  load();
  const existing = registry.get(agentId);
  if (existing) return existing;
  const p = emptyProfile(agentId);
  registry.set(agentId, p);
  persist();
  return p;
}

export function update(agentId: string, partial: Partial<FleetProfile>): FleetProfile {
  load();
  const prev = registry.get(agentId) ?? emptyProfile(agentId);
  const next: FleetProfile = {
    ...prev,
    ...partial,
    agentId, // never overridable
    updatedAt: Date.now(),
  };
  registry.set(agentId, next);
  persist();
  return next;
}

export function getLeaderboard(): FleetProfile[] {
  load();
  return Array.from(registry.values()).sort((a, b) => b.trustScore - a.trustScore);
}

export function clear(): void {
  load();
  registry.clear();
  persist();
}

export const FLEET_PATH = FLEET_FILE;
