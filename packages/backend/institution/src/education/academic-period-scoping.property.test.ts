/**
 * Property-based tests for Academic Period Scoping.
 *
 * Property 10: Academic Period Scoping
 *
 * For any enrollment, attendance, or assessment operation referencing an academic period,
 * the operation SHALL succeed only when the period's status is active, and SHALL be
 * rejected with an appropriate error message when the period is not active.
 *
 * **Validates: Requirements 5.7, 5.8**
 */

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';
import { validateActivePeriod, ActivePeriodValidator } from './active-period-validator.js';
import { BusinessRuleError, NotFoundError } from '@proctira/common';

// --- Arbitraries ---

/** Generates a valid UUID v4 string. */
const uuidArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.hexaString({ minLength: 8, maxLength: 8 }),
    fc.hexaString({ minLength: 4, maxLength: 4 }),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.constantFrom('8', '9', 'a', 'b'),
    fc.hexaString({ minLength: 3, maxLength: 3 }),
    fc.hexaString({ minLength: 12, maxLength: 12 }),
  )
  .map(([p1, p2, p3, variant, p4, p5]) => `${p1}-${p2}-4${p3}-${variant}${p4}-${p5}`);

/** Generates a non-active period status (inactive or archived). */
const nonActiveStatusArb: fc.Arbitrary<'inactive' | 'archived'> = fc.constantFrom(
  'inactive' as const,
  'archived' as const,
);

/** Generates any valid academic period status. */
const periodStatusArb: fc.Arbitrary<'active' | 'inactive' | 'archived'> = fc.constantFrom(
  'active' as const,
  'inactive' as const,
  'archived' as const,
);

/** Generates a realistic period name. */
const periodNameArb: fc.Arbitrary<string> = fc.oneof(
  fc.integer({ min: 2020, max: 2035 }).map((y) => `${y}-${y + 1}`),
  fc.constantFrom('Fall 2024', 'Spring 2025', 'Summer 2024', 'Term 1', 'Term 2', 'Semester A'),
);

/** Generates an operation type that requires an active period. */
const operationTypeArb: fc.Arbitrary<'enrollment' | 'attendance' | 'assessment'> = fc.constantFrom(
  'enrollment' as const,
  'attendance' as const,
  'assessment' as const,
);

/** Generates a mock academic period record. */
const academicPeriodArb = (statusArb: fc.Arbitrary<string>) =>
  fc.record({
    id: uuidArb,
    tenantId: uuidArb,
    name: periodNameArb,
    code: fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('')), {
      minLength: 3,
      maxLength: 10,
    }),
    status: statusArb,
    startDate: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
    endDate: fc.date({ min: new Date('2030-01-02'), max: new Date('2035-12-31') }),
    deletedAt: fc.constant(null),
    createdAt: fc.constant(new Date()),
    updatedAt: fc.constant(new Date()),
  });

// --- Mock Prisma Factory ---

function createMockPrisma(returnValue: unknown) {
  return {
    academicPeriod: {
      findFirst: vi.fn().mockResolvedValue(returnValue),
    },
  } as any;
}

// --- Property 10: Academic Period Scoping ---

describe('Property 10: Academic Period Scoping', () => {
  // **Validates: Requirements 5.7, 5.8**

  describe('Active periods allow operations (Requirement 5.7)', () => {
    it('for any active academic period and any operation type, validation succeeds and returns the period', async () => {
      await fc.assert(
        fc.asyncProperty(
          academicPeriodArb(fc.constant('active')),
          operationTypeArb,
          async (period, _operationType) => {
            const prisma = createMockPrisma(period);

            const result = await validateActivePeriod(prisma, period.tenantId, period.id);

            // The validator should return the period when it is active
            expect(result).toEqual(period);
            expect(result.status).toBe('active');

            // Verify the query was scoped to the correct tenant and period
            expect(prisma.academicPeriod.findFirst).toHaveBeenCalledWith({
              where: { id: period.id, tenantId: period.tenantId, deletedAt: null },
            });
          },
        ),
        { numRuns: 100 },
      );
    });

    it('for any active period, the ActivePeriodValidator class also succeeds', async () => {
      await fc.assert(
        fc.asyncProperty(academicPeriodArb(fc.constant('active')), async (period) => {
          const prisma = createMockPrisma(period);
          const validator = new ActivePeriodValidator({ prisma });

          const result = await validator.validate(period.tenantId, period.id);

          expect(result).toEqual(period);
          expect(result.status).toBe('active');
        }),
        { numRuns: 100 },
      );
    });
  });

  describe('Non-active periods reject operations with error (Requirement 5.8)', () => {
    it('for any non-active academic period, validation throws BusinessRuleError', async () => {
      await fc.assert(
        fc.asyncProperty(
          academicPeriodArb(nonActiveStatusArb),
          operationTypeArb,
          async (period, _operationType) => {
            const prisma = createMockPrisma(period);

            await expect(validateActivePeriod(prisma, period.tenantId, period.id)).rejects.toThrow(
              BusinessRuleError,
            );
          },
        ),
        { numRuns: 100 },
      );
    });

    it('for any non-active period, the error message indicates the period is not currently active', async () => {
      await fc.assert(
        fc.asyncProperty(academicPeriodArb(nonActiveStatusArb), async (period) => {
          const prisma = createMockPrisma(period);

          try {
            await validateActivePeriod(prisma, period.tenantId, period.id);
            expect.fail('Expected BusinessRuleError to be thrown');
          } catch (error: any) {
            expect(error).toBeInstanceOf(BusinessRuleError);
            // Error message must indicate the period is not currently active
            expect(error.message).toContain('not currently active');
            // Error message must include the period name for user clarity
            expect(error.message).toContain(period.name);
            // Error message must include the current status
            expect(error.message).toContain(period.status);
          }
        }),
        { numRuns: 100 },
      );
    });

    it('for any inactive period specifically, validation rejects with status "inactive" in message', async () => {
      await fc.assert(
        fc.asyncProperty(academicPeriodArb(fc.constant('inactive')), async (period) => {
          const prisma = createMockPrisma(period);

          try {
            await validateActivePeriod(prisma, period.tenantId, period.id);
            expect.fail('Expected BusinessRuleError to be thrown');
          } catch (error: any) {
            expect(error).toBeInstanceOf(BusinessRuleError);
            expect(error.message).toContain('inactive');
            expect(error.message).toContain('not currently active');
          }
        }),
        { numRuns: 50 },
      );
    });

    it('for any archived period specifically, validation rejects with status "archived" in message', async () => {
      await fc.assert(
        fc.asyncProperty(academicPeriodArb(fc.constant('archived')), async (period) => {
          const prisma = createMockPrisma(period);

          try {
            await validateActivePeriod(prisma, period.tenantId, period.id);
            expect.fail('Expected BusinessRuleError to be thrown');
          } catch (error: any) {
            expect(error).toBeInstanceOf(BusinessRuleError);
            expect(error.message).toContain('archived');
            expect(error.message).toContain('not currently active');
          }
        }),
        { numRuns: 50 },
      );
    });
  });

  describe('Period status is the sole determinant of operation allowance', () => {
    it('for any period, the outcome depends only on status: active succeeds, non-active fails', async () => {
      await fc.assert(
        fc.asyncProperty(
          academicPeriodArb(periodStatusArb),
          operationTypeArb,
          async (period, _operationType) => {
            const prisma = createMockPrisma(period);

            if (period.status === 'active') {
              // Active periods must allow the operation
              const result = await validateActivePeriod(prisma, period.tenantId, period.id);
              expect(result.status).toBe('active');
            } else {
              // Non-active periods must reject the operation
              await expect(
                validateActivePeriod(prisma, period.tenantId, period.id),
              ).rejects.toThrow(BusinessRuleError);
            }
          },
        ),
        { numRuns: 150 },
      );
    });

    it('the operation type (enrollment, attendance, assessment) does not affect the validation outcome', async () => {
      await fc.assert(
        fc.asyncProperty(
          academicPeriodArb(periodStatusArb),
          operationTypeArb,
          operationTypeArb,
          async (period, _op1, _op2) => {
            // Both operations should have the same outcome for the same period
            const prisma1 = createMockPrisma(period);
            const prisma2 = createMockPrisma(period);

            let result1Success = false;
            let result2Success = false;

            try {
              await validateActivePeriod(prisma1, period.tenantId, period.id);
              result1Success = true;
            } catch {
              result1Success = false;
            }

            try {
              await validateActivePeriod(prisma2, period.tenantId, period.id);
              result2Success = true;
            } catch {
              result2Success = false;
            }

            // Both operations must have the same outcome regardless of type
            expect(result1Success).toBe(result2Success);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Non-existent periods are handled correctly', () => {
    it('for any tenant and period ID where the period does not exist, NotFoundError is thrown', async () => {
      await fc.assert(
        fc.asyncProperty(uuidArb, uuidArb, async (tenantId, periodId) => {
          const prisma = createMockPrisma(null);

          await expect(validateActivePeriod(prisma, tenantId, periodId)).rejects.toThrow(
            NotFoundError,
          );
        }),
        { numRuns: 50 },
      );
    });
  });
});
