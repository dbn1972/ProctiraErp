/**
 * Shared fast-check arbitraries used across every tenant-isolation category.
 * Centralised here so that all seven test suites generate compatible inputs
 * and so that any tightening of validation (UUID format, slug rules) only
 * needs to happen in one place.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 */

import * as fc from 'fast-check';

/** Generates a valid UUID v4 string. */
export const uuidV4Arb: fc.Arbitrary<string> = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.constantFrom('8', '9', 'a', 'b'),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.hexaString({ minLength: 12, maxLength: 12 }),
  )
  .map(([p1, p2, p3, variant, p4, p5]) => `${p1}-${p2}-4${p3}-${variant}${p4}-${p5}`);

/** Generates two distinct UUID v4 tenant IDs. */
export const distinctTenantPairArb: fc.Arbitrary<{ tenantA: string; tenantB: string }> = fc
  .tuple(uuidV4Arb, uuidV4Arb)
  .filter(([a, b]) => a !== b)
  .map(([tenantA, tenantB]) => ({ tenantA, tenantB }));

/** Generates an array of N distinct tenant UUIDs (3..6). */
export const distinctTenantSetArb: fc.Arbitrary<string[]> = fc
  .uniqueArray(uuidV4Arb, { minLength: 3, maxLength: 6 });

/** A non-empty entity name made of letters and spaces. */
export const entityNameArb: fc.Arbitrary<string> = fc
  .stringOf(
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '.split('')),
    { minLength: 2, maxLength: 40 },
  )
  .filter((s) => s.trim().length >= 2);

/** A short uppercase alphanumeric code. */
export const entityCodeArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')),
  { minLength: 3, maxLength: 10 },
);

/** A normalized record shape used across categories. */
export interface IsolationRecord {
  id: string;
  name: string;
  code: string;
  tenantId: string;
}

/** Generates an `IsolationRecord` with random tenantId (callers usually overwrite). */
export const isolationRecordArb: fc.Arbitrary<IsolationRecord> = fc
  .tuple(uuidV4Arb, entityNameArb, entityCodeArb, uuidV4Arb)
  .map(([id, name, code, tenantId]) => ({ id, name, code, tenantId }));

/** Domain-relevant aggregate types that drive Kafka topic / RabbitMQ task names. */
export const aggregateTypeArb: fc.Arbitrary<string> = fc.constantFrom(
  'student',
  'institution',
  'staff',
  'attendance',
  'assessment',
  'workflow',
  'report',
  'enrollment',
  'academic-period',
);

/** RabbitMQ task identifiers used for queue/routing-key tests. */
export const taskTypeArb: fc.Arbitrary<string> = fc.constantFrom(
  'report.generate',
  'import.process',
  'notification.send',
  'etl.execute',
  'export.archive',
);

/** Cache key prefixes that map onto real product features. */
export const cacheKeyArb: fc.Arbitrary<string> = fc
  .stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789:_-'.split('')),
    { minLength: 5, maxLength: 50 },
  )
  .filter((s) => /^[a-z]/.test(s));

/** Resource action verbs used by RBAC. */
export const actionVerbArb: fc.Arbitrary<'create' | 'read' | 'update' | 'delete'> =
  fc.constantFrom('create', 'read', 'update', 'delete');

/** Resource types used by RBAC. */
export const resourceTypeArb: fc.Arbitrary<string> = fc.constantFrom(
  'institution',
  'student',
  'staff',
  'assessment',
  'attendance',
  'report',
);
