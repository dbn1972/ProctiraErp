import { describe, expect, it } from 'vitest';
import { coverageRowsFrom } from './coverage-rows';

describe('coverageRowsFrom (PRC-L242)', () => {
  it('never fabricates a taughtAt value when the API omits dates', () => {
    const rows = coverageRowsFrom({ taughtUnitIds: ['u1', 'u2'] });
    expect(rows).toEqual([
      { unitId: 'u1', taughtAt: null },
      { unitId: 'u2', taughtAt: null },
    ]);
    expect(rows.some((r) => r.taughtAt === 'taught')).toBe(false);
  });

  it('uses real timestamps when supplied and ignores invalid ones', () => {
    const rows = coverageRowsFrom({
      taughtUnitIds: ['u1', 'u2'],
      taughtUnits: [
        { unitId: 'u1', taughtAt: '2026-04-01T09:00:00.000Z' },
        { unitId: 'u2', taughtAt: 'taught' },
      ],
    });
    expect(rows).toEqual([
      { unitId: 'u1', taughtAt: '2026-04-01T09:00:00.000Z' },
      { unitId: 'u2', taughtAt: null },
    ]);
  });

  it('returns [] without coverage', () => {
    expect(coverageRowsFrom(null)).toEqual([]);
  });
});
