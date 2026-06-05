import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runChaosSuite, ScenarioResult } from '../chaos/harness';
import { clear } from '../src/intelligence/fleet';

let result: Awaited<ReturnType<typeof runChaosSuite>>;

beforeEach(() => {
  clear();
});

describe('chaos harness — every scenario catches its expectedViolations', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  result = await runChaosSuite();
  warn.mockRestore();

  it('runs every scenario without throwing', () => {
    expect(result.scenarios.length).toBe(10);
  });

  it.each(result.scenarios.map((r) => [r.name, r] as const))(
    '%s catches every expected metric (no missed)',
    (_name: string, r: ScenarioResult) => {
      expect(r.missedMetrics).toEqual([]);
      expect(r.caught).toBe(true);
    },
  );

  it('control produces zero false positives', () => {
    expect(result.control.falsePositive).toBe(false);
    expect(result.control.unexpectedMetrics).toEqual([]);
  });

  it('aggregate detection rate is 100% over detectable scenarios', () => {
    expect(result.aggregates.detectionRate).toBe(1);
  });

  it('aggregate false-positive rate is 0%', () => {
    expect(result.aggregates.falsePositiveRate).toBe(0);
  });

  it('aggregate mean time-to-detection is finite and low', () => {
    expect(Number.isFinite(result.aggregates.meanTimeToDetection)).toBe(true);
    expect(result.aggregates.meanTimeToDetection).toBeGreaterThan(0);
    expect(result.aggregates.meanTimeToDetection).toBeLessThan(20);
  });
});
