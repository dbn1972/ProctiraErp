/**
 * PRC-L472: the PHI package must keep coverage floors in its vitest config so
 * a `vitest run --coverage` (CI unit job) fails when PHI code loses tests.
 */
import { describe, expect, it } from 'vitest';

import config from '../vitest.config.js';

type Floors = { lines?: number; statements?: number; functions?: number; branches?: number };

describe('PRC-L472: health vitest coverage thresholds', () => {
  const coverage = (config.test?.coverage ?? {}) as {
    provider?: string;
    thresholds?: Record<string, unknown>;
  };
  const thresholds = coverage.thresholds ?? {};

  it('sets package-wide floors for every metric', () => {
    for (const metric of ['lines', 'statements', 'functions', 'branches'] as const) {
      expect(thresholds[metric], metric).toEqual(expect.any(Number));
      expect(thresholds[metric] as number, metric).toBeGreaterThan(0);
    }
  });

  it('sets stricter floors on the PHI modules than on the package', () => {
    const phi = thresholds['src/phi-*.ts'] as Floors | undefined;
    expect(phi).toBeDefined();
    expect(phi!.lines!).toBeGreaterThan(thresholds.lines as number);
    expect(phi!.branches!).toBeGreaterThan(thresholds.branches as number);
  });

  it('keeps passWithNoTests off', () => {
    expect(config.test?.passWithNoTests).toBe(false);
  });
});
