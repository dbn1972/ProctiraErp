/**
 * PRC-L002: DATE columns arrive from node-pg as local midnight; the calendar day must not shift
 * when the process runs east of UTC.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { dateOnly } from './pg-registration-repository.js';

const originalTz = process.env['TZ'];

describe('PRC-L002 dateOnly', () => {
  afterEach(() => {
    if (originalTz === undefined) delete process.env['TZ'];
    else process.env['TZ'] = originalTz;
  });

  it.each(['Asia/Kolkata', 'Pacific/Auckland', 'America/Los_Angeles', 'UTC'])(
    'keeps the stored calendar day with TZ=%s',
    (zone) => {
      process.env['TZ'] = zone;
      // What node-pg builds for DATE '2010-01-01': local midnight in the process zone.
      expect(dateOnly(new Date(2010, 0, 1))).toBe('2010-01-01');
      expect(dateOnly(new Date(2024, 1, 29))).toBe('2024-02-29');
    },
  );

  it('passes date strings through', () => {
    expect(dateOnly('2012-03-04')).toBe('2012-03-04');
    expect(dateOnly('2012-03-04T00:00:00Z')).toBe('2012-03-04');
  });
});
