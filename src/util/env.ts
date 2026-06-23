/**
 * Tiny .env loader (no dependency). Loads .env, then fills any gaps from
 * .env.example, into process.env without overwriting already-set vars.
 *
 * Used by every demo entry point so a single WATCHDOG_AI_API_KEY in .env
 * lights up Layer 3 (diagnosis) AND Layer 6 (the AI supervisor) everywhere.
 */
import * as fs from 'fs';
import * as path from 'path';

export function loadDotenv(rootDir?: string): void {
  const root = rootDir ?? path.join(__dirname, '..', '..');
  for (const file of ['.env', '.env.example']) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[2] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}

/** True if an AI key + model are configured (Layers 3 & 6 run the real LLM). */
export function aiConfigured(): boolean {
  return !!(process.env.WATCHDOG_AI_API_KEY && process.env.WATCHDOG_AI_MODEL);
}
