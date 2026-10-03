import { describe, expect, it } from 'vitest';
import { areaColumn, genderColumn } from './prisma-result-repository.js';
import { UNKNOWN_AREA_ID } from './result-repository.js';

// PRC-M240: examination_candidates.gender/area_id are nullable (migration 111); unknown
// demographics are persisted as NULL instead of a synthesised 'other' / nil-UUID area.
describe('candidate demographic columns (PRC-M240)', () => {
  it('stores unknown gender as NULL and keeps known values', () => {
    expect(genderColumn('unknown')).toBeNull();
    expect(genderColumn('female')).toBe('female');
    expect(genderColumn('other')).toBe('other');
  });

  it('stores the nil-UUID area sentinel (or empty) as NULL', () => {
    expect(areaColumn(UNKNOWN_AREA_ID)).toBeNull();
    expect(areaColumn('')).toBeNull();
    const area = '11111111-1111-4111-8111-111111111111';
    expect(areaColumn(area)).toBe(area);
  });
});
