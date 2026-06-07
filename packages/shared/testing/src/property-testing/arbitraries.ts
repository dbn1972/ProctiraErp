/**
 * fast-check arbitraries for common domain types.
 * These generate valid random values for property-based testing.
 */

import * as fc from 'fast-check';

/**
 * Generates valid UUID v4 strings.
 */
export const uuidArb: fc.Arbitrary<string> = fc.uuid();

/**
 * Generates valid email addresses.
 */
export const emailArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')), {
      minLength: 1,
      maxLength: 20,
    }),
    fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')), {
      minLength: 2,
      maxLength: 10,
    }),
    fc.constantFrom('com', 'org', 'edu', 'net', 'io'),
  )
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

/**
 * Generates realistic person names (first or last).
 */
export const nameArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('')),
  { minLength: 2, maxLength: 50 },
);

/**
 * Generates valid ISO date strings (YYYY-MM-DD).
 */
export const dateArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.integer({ min: 2000, max: 2030 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 }), // Use 28 to avoid invalid dates
  )
  .map(([year, month, day]) => {
    const m = String(month).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
  });

/**
 * Generates Date objects within a reasonable range.
 */
export const dateObjectArb: fc.Arbitrary<Date> = fc
  .integer({ min: 946684800000, max: 1893456000000 }) // 2000-01-01 to 2030-01-01
  .map((ts) => new Date(ts));

/**
 * Generates valid pagination options.
 */
export const paginationArb: fc.Arbitrary<{ page: number; pageSize: number }> = fc.record({
  page: fc.integer({ min: 1, max: 1000 }),
  pageSize: fc.integer({ min: 1, max: 100 }),
});

/**
 * Generates valid pagination options with sort.
 */
export const paginationWithSortArb: fc.Arbitrary<{
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}> = fc.record({
  page: fc.integer({ min: 1, max: 1000 }),
  pageSize: fc.integer({ min: 1, max: 100 }),
  sortBy: fc.constantFrom('name', 'createdAt', 'updatedAt', 'code', 'status'),
  sortOrder: fc.constantFrom('asc' as const, 'desc' as const),
});

/**
 * Generates valid phone number strings.
 */
export const phoneArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom('+1', '+44', '+91', '+61', '+33'),
    fc.stringOf(fc.constantFrom(...'0123456789'.split('')), { minLength: 9, maxLength: 10 }),
  )
  .map(([prefix, number]) => `${prefix}${number}`);

/**
 * Generates valid tenant slugs.
 */
export const tenantSlugArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 3, maxLength: 30 },
).filter((s) => /^[a-z]/.test(s) && !s.endsWith('-') && !s.includes('--'));

/**
 * Generates valid area level numbers (1-10).
 */
export const areaLevelArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 10 });

/**
 * Generates valid enrollment status values.
 */
export const enrollmentStatusArb: fc.Arbitrary<string> = fc.constantFrom(
  'ENROLLED',
  'TRANSFERRED',
  'WITHDRAWN',
  'GRADUATED',
);

/**
 * Generates valid entity status values.
 */
export const entityStatusArb: fc.Arbitrary<string> = fc.constantFrom(
  'ACTIVE',
  'INACTIVE',
  'ARCHIVED',
);

/**
 * Generates valid attendance status values.
 */
export const attendanceStatusArb: fc.Arbitrary<string> = fc.constantFrom(
  'PRESENT',
  'ABSENT',
  'LATE',
  'EXCUSED',
);

/**
 * Generates a positive integer for capacity values (1-99999).
 */
export const capacityArb: fc.Arbitrary<number> = fc.integer({ min: 1, max: 99999 });

/**
 * Generates a percentage value (0-100) with up to 2 decimal places.
 */
export const percentageArb: fc.Arbitrary<number> = fc
  .integer({ min: 0, max: 10000 })
  .map((n) => n / 100);
