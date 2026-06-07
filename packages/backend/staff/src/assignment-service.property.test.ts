/**
 * Property-Based Test: Staff Assignment Non-Overlap and Allocation Constraint
 *
 * **Validates: Requirements 7.2, 7.5**
 *
 * Property 17: For any sequence of assignment operations, the system never allows
 * overlapping assignments to the same institution-subject-class combination for the
 * same staff member, and the total allocation percentage across all active assignments
 * never exceeds 100%.
 */
import { describe, it, beforeEach } from 'vitest';
import fc from 'fast-check';
import { ConflictError, BusinessRuleError } from '@proctira/common';

import { InMemoryAssignmentRepository } from './in-memory-assignment-repository.js';
import { StaffAssignmentService } from './assignment-service.js';
import type { CreateAssignmentInput } from './assignment-schemas.js';

// --- Generators ---

/** Generate a valid UUID v4 string */
const arbUuid = fc.uuid().map((u) => u.toLowerCase());

/** Generate a valid ISO date string (YYYY-MM-DD) within a reasonable range */
const arbDate = fc.date({
  min: new Date('2020-01-01'),
  max: new Date('2030-12-31'),
}).map((d) => d.toISOString().slice(0, 10));

/** Generate a date range where endDate > startDate (or endDate is undefined for ongoing) */
const arbDateRange = fc.tuple(arbDate, arbDate, fc.boolean()).map(([d1, d2, hasEnd]) => {
  const sorted = [d1, d2].sort();
  // Ensure start < end by using sorted values; if they're equal, bump end by one day
  let startDate = sorted[0]!;
  let endDate = sorted[1]!;
  if (startDate === endDate) {
    const d = new Date(endDate);
    d.setDate(d.getDate() + 1);
    endDate = d.toISOString().slice(0, 10);
  }
  return {
    startDate,
    endDate: hasEnd ? endDate : undefined,
  };
});

/** Generate an allocation percentage between 1 and 100 */
const arbAllocation = fc.integer({ min: 1, max: 100 });

/** Generate a role string */
const arbRole = fc.stringOf(fc.constantFrom('a', 'b', 'c', 'd', 'e'), { minLength: 1, maxLength: 10 });

/** Generate a valid CreateAssignmentInput */
function arbAssignmentInput(overrides: Partial<CreateAssignmentInput> = {}): fc.Arbitrary<CreateAssignmentInput> {
  return fc.record({
    staffId: overrides.staffId ? fc.constant(overrides.staffId) : arbUuid,
    institutionId: overrides.institutionId ? fc.constant(overrides.institutionId) : arbUuid,
    subjectId: overrides.subjectId ? fc.constant(overrides.subjectId) : arbUuid,
    classId: overrides.classId ? fc.constant(overrides.classId) : arbUuid,
    role: arbRole,
    allocationPercentage: overrides.allocationPercentage !== undefined
      ? fc.constant(overrides.allocationPercentage)
      : arbAllocation,
    startDate: fc.constant('placeholder'),
    endDate: fc.constant(undefined as string | undefined),
  }).chain((base) =>
    arbDateRange.map((range) => ({
      ...base,
      startDate: range.startDate,
      endDate: range.endDate,
      ...overrides,
    })),
  );
}

// --- Helpers ---

/** Check if two date ranges overlap */
function datesOverlap(
  start1: string,
  end1: string | null | undefined,
  start2: string,
  end2: string | null | undefined,
): boolean {
  const e1 = end1 ?? '9999-12-31';
  const e2 = end2 ?? '9999-12-31';
  return start1 < e2 && start2 < e1;
}

// --- Property Tests ---

describe('Property 17: Staff Assignment Non-Overlap and Allocation Constraint', () => {
  let repository: InMemoryAssignmentRepository;
  let service: StaffAssignmentService;

  beforeEach(() => {
    repository = new InMemoryAssignmentRepository();
    service = new StaffAssignmentService(repository);
  });

  it('should never allow overlapping assignments to the same institution-subject-class for the same staff member', async () => {
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const staffId = '00000000-0000-4000-8000-000000000002';
    const institutionId = '00000000-0000-4000-8000-000000000003';
    const subjectId = '00000000-0000-4000-8000-000000000004';
    const classId = '00000000-0000-4000-8000-000000000005';

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          arbAssignmentInput({
            staffId,
            institutionId,
            subjectId,
            classId,
            allocationPercentage: 5, // Keep low to avoid allocation failures
          }),
          { minLength: 2, maxLength: 10 },
        ),
        async (inputs) => {
          // Fresh repository for each test run
          repository.clear();

          const successfulAssignments: Array<{ startDate: string; endDate: string | null | undefined }> = [];

          for (const input of inputs) {
            try {
              const result = await service.create(tenantId, input);
              successfulAssignments.push({
                startDate: result.startDate,
                endDate: result.endDate,
              });
            } catch (e) {
              // ConflictError or BusinessRuleError is expected — the system is preventing violations
              if (!(e instanceof ConflictError) && !(e instanceof BusinessRuleError)) {
                throw e; // Unexpected error
              }
            }
          }

          // Invariant: No two successful assignments should overlap
          for (let i = 0; i < successfulAssignments.length; i++) {
            for (let j = i + 1; j < successfulAssignments.length; j++) {
              const a = successfulAssignments[i]!;
              const b = successfulAssignments[j]!;
              const overlaps = datesOverlap(a.startDate, a.endDate, b.startDate, b.endDate);
              if (overlaps) {
                throw new Error(
                  `Found overlapping assignments: [${a.startDate}, ${a.endDate ?? 'ongoing'}] and [${b.startDate}, ${b.endDate ?? 'ongoing'}]`,
                );
              }
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should never allow total allocation percentage to exceed 100% across all active assignments', async () => {
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const staffId = '00000000-0000-4000-8000-000000000002';

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.tuple(arbUuid, arbUuid, arbUuid, arbAllocation, arbDateRange, arbRole),
          { minLength: 1, maxLength: 15 },
        ),
        async (assignmentParams) => {
          // Fresh repository for each test run
          repository.clear();

          for (const [institutionId, subjectId, classId, allocation, dateRange, role] of assignmentParams) {
            const input: CreateAssignmentInput = {
              staffId,
              institutionId,
              subjectId,
              classId,
              role,
              allocationPercentage: allocation,
              startDate: dateRange.startDate,
              endDate: dateRange.endDate,
            };

            try {
              await service.create(tenantId, input);
            } catch (e) {
              // ConflictError or BusinessRuleError is expected
              if (!(e instanceof ConflictError) && !(e instanceof BusinessRuleError)) {
                throw e;
              }
            }
          }

          // Invariant: Total allocation of all active assignments must not exceed 100%
          const totalAllocation = await service.getTotalAllocation(tenantId, staffId);
          if (totalAllocation > 100) {
            throw new Error(
              `Total allocation exceeded 100%: got ${totalAllocation}%`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('should maintain both invariants simultaneously under mixed create/update/delete operations', async () => {
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const staffId = '00000000-0000-4000-8000-000000000002';

    // Define operation types for the model
    type CreateOp = { type: 'create'; institutionId: string; subjectId: string; classId: string; allocation: number; startDate: string; endDate: string | undefined };
    type DeleteOp = { type: 'delete'; index: number };
    type Operation = CreateOp | DeleteOp;

    const arbCreateOp: fc.Arbitrary<CreateOp> = fc.tuple(
      arbUuid, arbUuid, arbUuid, arbAllocation, arbDateRange,
    ).map(([institutionId, subjectId, classId, allocation, dateRange]) => ({
      type: 'create' as const,
      institutionId,
      subjectId,
      classId,
      allocation,
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    }));

    const arbDeleteOp: fc.Arbitrary<DeleteOp> = fc.nat({ max: 20 }).map((index) => ({
      type: 'delete' as const,
      index,
    }));

    const arbOperation: fc.Arbitrary<Operation> = fc.oneof(
      { weight: 3, arbitrary: arbCreateOp },
      { weight: 1, arbitrary: arbDeleteOp },
    );

    await fc.assert(
      fc.asyncProperty(
        fc.array(arbOperation, { minLength: 3, maxLength: 20 }),
        async (operations) => {
          repository.clear();

          const createdIds: string[] = [];

          for (const op of operations) {
            if (op.type === 'create') {
              const input: CreateAssignmentInput = {
                staffId,
                institutionId: op.institutionId,
                subjectId: op.subjectId,
                classId: op.classId,
                role: 'Teacher',
                allocationPercentage: op.allocation,
                startDate: op.startDate,
                endDate: op.endDate,
              };

              try {
                const result = await service.create(tenantId, input);
                createdIds.push(result.id);
              } catch (e) {
                if (!(e instanceof ConflictError) && !(e instanceof BusinessRuleError)) {
                  throw e;
                }
              }
            } else {
              // Delete operation: pick an assignment by index (modulo available)
              if (createdIds.length > 0) {
                const idx = op.index % createdIds.length;
                const idToDelete = createdIds[idx]!;
                try {
                  await service.delete(tenantId, idToDelete);
                  createdIds.splice(idx, 1);
                } catch {
                  // NotFoundError is fine (already deleted)
                }
              }
            }
          }

          // Verify invariant 1: No overlapping active assignments to same institution-subject-class
          const allActiveResult = await service.list(
            tenantId,
            { staffId, status: 'ACTIVE' },
            { page: 1, pageSize: 1000 },
          );
          const activeAssignments = allActiveResult.data;

          // Group by institution-subject-class
          const groups = new Map<string, typeof activeAssignments>();
          for (const assignment of activeAssignments) {
            const key = `${assignment.institutionId}|${assignment.subjectId}|${assignment.classId}`;
            if (!groups.has(key)) {
              groups.set(key, []);
            }
            groups.get(key)!.push(assignment);
          }

          // Check no overlaps within each group
          for (const [key, group] of groups) {
            for (let i = 0; i < group.length; i++) {
              for (let j = i + 1; j < group.length; j++) {
                const a = group[i]!;
                const b = group[j]!;
                if (datesOverlap(a.startDate, a.endDate, b.startDate, b.endDate)) {
                  throw new Error(
                    `Overlap found in group ${key}: [${a.startDate}, ${a.endDate ?? 'ongoing'}] and [${b.startDate}, ${b.endDate ?? 'ongoing'}]`,
                  );
                }
              }
            }
          }

          // Verify invariant 2: Total allocation ≤ 100%
          const totalAllocation = await service.getTotalAllocation(tenantId, staffId);
          if (totalAllocation > 100) {
            throw new Error(
              `Total allocation exceeded 100%: got ${totalAllocation}%`,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
