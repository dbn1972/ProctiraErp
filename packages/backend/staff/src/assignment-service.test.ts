/**
 * Unit tests for StaffAssignmentService.
 *
 * Tests cover:
 * - Create assignment with required fields
 * - Prevent overlapping assignments to same institution-subject-class
 * - Enforce total allocation ≤ 100% across active assignments
 * - Update assignment with constraint checks
 * - Get by ID
 * - List with filtering
 * - Delete assignment
 * - End date validation (must be after start date)
 *
 * Requirements:
 * - 7.2: Prevent overlapping assignments to same institution-subject-class
 * - 7.5: Total allocation across active assignments ≤ 100%
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, BusinessRuleError } from '@proctira/common';

import { InMemoryAssignmentRepository } from './in-memory-assignment-repository.js';
import { StaffAssignmentService } from './assignment-service.js';
import type { CreateAssignmentInput } from './assignment-schemas.js';

// Helper to generate valid UUIDs for testing
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();
const STAFF_ID = uuid();
const INSTITUTION_ID = uuid();
const SUBJECT_ID = uuid();
const CLASS_ID = uuid();

function validAssignmentInput(
  overrides: Partial<CreateAssignmentInput> = {},
): CreateAssignmentInput {
  return {
    staffId: STAFF_ID,
    institutionId: INSTITUTION_ID,
    subjectId: SUBJECT_ID,
    classId: CLASS_ID,
    role: 'Teacher',
    allocationPercentage: 50,
    startDate: '2024-01-01',
    endDate: '2024-06-30',
    ...overrides,
  };
}

describe('StaffAssignmentService', () => {
  let repository: InMemoryAssignmentRepository;
  let service: StaffAssignmentService;

  beforeEach(() => {
    repository = new InMemoryAssignmentRepository();
    service = new StaffAssignmentService(repository);
  });

  describe('create', () => {
    it('should create an assignment with all required fields', async () => {
      const input = validAssignmentInput();
      const result = await service.create(TENANT_ID, input);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.staffId).toBe(input.staffId);
      expect(result.institutionId).toBe(input.institutionId);
      expect(result.subjectId).toBe(input.subjectId);
      expect(result.classId).toBe(input.classId);
      expect(result.role).toBe(input.role);
      expect(result.allocationPercentage).toBe(input.allocationPercentage);
      expect(result.startDate).toBe(input.startDate);
      expect(result.endDate).toBe(input.endDate);
      expect(result.status).toBe('ACTIVE');
      expect(result.tenantId).toBe(TENANT_ID);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it('should create an assignment without end date (ongoing)', async () => {
      const input = validAssignmentInput({ endDate: undefined });
      const result = await service.create(TENANT_ID, input);

      expect(result.endDate).toBeNull();
    });

    it('should throw BusinessRuleError when end date is before start date', async () => {
      const input = validAssignmentInput({
        startDate: '2024-06-01',
        endDate: '2024-01-01',
      });

      await expect(service.create(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
      await expect(service.create(TENANT_ID, input)).rejects.toThrow(
        'End date must be after start date',
      );
    });

    it('should throw BusinessRuleError when end date equals start date', async () => {
      const input = validAssignmentInput({
        startDate: '2024-06-01',
        endDate: '2024-06-01',
      });

      await expect(service.create(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
    });

    describe('overlapping assignment prevention (Requirement 7.2)', () => {
      it('should throw ConflictError for overlapping date ranges on same institution-subject-class', async () => {
        // Create first assignment: Jan-Jun 2024
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            startDate: '2024-01-01',
            endDate: '2024-06-30',
          }),
        );

        // Try to create overlapping assignment: Mar-Sep 2024
        const overlapping = validAssignmentInput({
          startDate: '2024-03-01',
          endDate: '2024-09-30',
        });

        await expect(service.create(TENANT_ID, overlapping)).rejects.toThrow(ConflictError);
        await expect(service.create(TENANT_ID, overlapping)).rejects.toThrow(
          'overlapping assignment',
        );
      });

      it('should throw ConflictError when new assignment is fully within existing range', async () => {
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            startDate: '2024-01-01',
            endDate: '2024-12-31',
          }),
        );

        const contained = validAssignmentInput({
          startDate: '2024-03-01',
          endDate: '2024-06-30',
        });

        await expect(service.create(TENANT_ID, contained)).rejects.toThrow(ConflictError);
      });

      it('should throw ConflictError when existing is ongoing and new overlaps', async () => {
        // Create ongoing assignment (no end date)
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            startDate: '2024-01-01',
            endDate: undefined,
          }),
        );

        // Try to create assignment starting after existing
        const overlapping = validAssignmentInput({
          startDate: '2024-06-01',
          endDate: '2024-12-31',
        });

        await expect(service.create(TENANT_ID, overlapping)).rejects.toThrow(ConflictError);
      });

      it('should throw ConflictError when both assignments are ongoing', async () => {
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            startDate: '2024-01-01',
            endDate: undefined,
          }),
        );

        const overlapping = validAssignmentInput({
          startDate: '2024-06-01',
          endDate: undefined,
        });

        await expect(service.create(TENANT_ID, overlapping)).rejects.toThrow(ConflictError);
      });

      it('should allow non-overlapping assignments to same institution-subject-class', async () => {
        // First assignment: Jan-Jun 2024
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            startDate: '2024-01-01',
            endDate: '2024-06-30',
          }),
        );

        // Second assignment: Jul-Dec 2024 (no overlap)
        const nonOverlapping = validAssignmentInput({
          startDate: '2024-07-01',
          endDate: '2024-12-31',
        });

        const result = await service.create(TENANT_ID, nonOverlapping);
        expect(result).toBeDefined();
        expect(result.startDate).toBe('2024-07-01');
      });

      it('should allow overlapping dates for different institution', async () => {
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            startDate: '2024-01-01',
            endDate: '2024-06-30',
          }),
        );

        const differentInstitution = validAssignmentInput({
          institutionId: uuid(),
          startDate: '2024-03-01',
          endDate: '2024-09-30',
        });

        const result = await service.create(TENANT_ID, differentInstitution);
        expect(result).toBeDefined();
      });

      it('should allow overlapping dates for different subject', async () => {
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            startDate: '2024-01-01',
            endDate: '2024-06-30',
          }),
        );

        const differentSubject = validAssignmentInput({
          subjectId: uuid(),
          startDate: '2024-03-01',
          endDate: '2024-09-30',
        });

        const result = await service.create(TENANT_ID, differentSubject);
        expect(result).toBeDefined();
      });

      it('should allow overlapping dates for different class', async () => {
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            startDate: '2024-01-01',
            endDate: '2024-06-30',
          }),
        );

        const differentClass = validAssignmentInput({
          classId: uuid(),
          startDate: '2024-03-01',
          endDate: '2024-09-30',
        });

        const result = await service.create(TENANT_ID, differentClass);
        expect(result).toBeDefined();
      });

      it('should allow overlapping dates for different staff member', async () => {
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            startDate: '2024-01-01',
            endDate: '2024-06-30',
          }),
        );

        const differentStaff = validAssignmentInput({
          staffId: uuid(),
          startDate: '2024-03-01',
          endDate: '2024-09-30',
        });

        const result = await service.create(TENANT_ID, differentStaff);
        expect(result).toBeDefined();
      });
    });

    describe('allocation percentage constraint (Requirement 7.5)', () => {
      it('should throw BusinessRuleError when total allocation would exceed 100%', async () => {
        // Create first assignment with 60% allocation
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            allocationPercentage: 60,
            institutionId: uuid(),
          }),
        );

        // Try to create second assignment with 50% (total would be 110%)
        const exceeding = validAssignmentInput({
          allocationPercentage: 50,
          institutionId: uuid(),
          subjectId: uuid(),
        });

        await expect(service.create(TENANT_ID, exceeding)).rejects.toThrow(BusinessRuleError);
        await expect(service.create(TENANT_ID, exceeding)).rejects.toThrow(
          'Total allocation would exceed 100%',
        );
      });

      it('should allow assignments that total exactly 100%', async () => {
        // Create first assignment with 60% allocation
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            allocationPercentage: 60,
            institutionId: uuid(),
          }),
        );

        // Create second assignment with 40% (total = 100%)
        const exactlyFull = validAssignmentInput({
          allocationPercentage: 40,
          institutionId: uuid(),
          subjectId: uuid(),
        });

        const result = await service.create(TENANT_ID, exactlyFull);
        expect(result).toBeDefined();
        expect(result.allocationPercentage).toBe(40);
      });

      it('should allow multiple assignments that total under 100%', async () => {
        const inst1 = uuid();
        const inst2 = uuid();
        const inst3 = uuid();

        await service.create(
          TENANT_ID,
          validAssignmentInput({
            allocationPercentage: 30,
            institutionId: inst1,
          }),
        );
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            allocationPercentage: 30,
            institutionId: inst2,
            subjectId: uuid(),
          }),
        );

        const third = validAssignmentInput({
          allocationPercentage: 30,
          institutionId: inst3,
          subjectId: uuid(),
          classId: uuid(),
        });

        const result = await service.create(TENANT_ID, third);
        expect(result).toBeDefined();
      });

      it('should not count inactive assignments toward allocation total', async () => {
        // Create assignment with 80% and then deactivate it
        const first = await service.create(
          TENANT_ID,
          validAssignmentInput({
            allocationPercentage: 80,
            institutionId: uuid(),
          }),
        );

        // Deactivate the first assignment
        await service.update(TENANT_ID, first.id, { status: 'INACTIVE' });

        // Should be able to create a new 80% assignment since the first is inactive
        const second = validAssignmentInput({
          allocationPercentage: 80,
          institutionId: uuid(),
          subjectId: uuid(),
        });

        const result = await service.create(TENANT_ID, second);
        expect(result).toBeDefined();
        expect(result.allocationPercentage).toBe(80);
      });

      it('should track allocation independently per staff member', async () => {
        const otherStaffId = uuid();

        // Staff 1 has 90% allocation
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            staffId: STAFF_ID,
            allocationPercentage: 90,
            institutionId: uuid(),
          }),
        );

        // Staff 2 should be able to have their own 90% allocation
        const otherStaffAssignment = validAssignmentInput({
          staffId: otherStaffId,
          allocationPercentage: 90,
          institutionId: uuid(),
        });

        const result = await service.create(TENANT_ID, otherStaffAssignment);
        expect(result).toBeDefined();
        expect(result.allocationPercentage).toBe(90);
      });
    });
  });

  describe('update', () => {
    it('should update an assignment with partial data', async () => {
      const input = validAssignmentInput();
      const created = await service.create(TENANT_ID, input);

      const updated = await service.update(TENANT_ID, created.id, {
        role: 'Senior Teacher',
        allocationPercentage: 60,
      });

      expect(updated.role).toBe('Senior Teacher');
      expect(updated.allocationPercentage).toBe(60);
      expect(updated.startDate).toBe(input.startDate);
    });

    it('should throw NotFoundError when assignment does not exist', async () => {
      const fakeId = uuid();
      await expect(service.update(TENANT_ID, fakeId, { role: 'New Role' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should throw ConflictError when date update creates overlap', async () => {
      // Create two non-overlapping assignments
      const first = await service.create(
        TENANT_ID,
        validAssignmentInput({
          startDate: '2024-01-01',
          endDate: '2024-06-30',
          allocationPercentage: 30,
        }),
      );

      await service.create(
        TENANT_ID,
        validAssignmentInput({
          startDate: '2024-07-01',
          endDate: '2024-12-31',
          allocationPercentage: 30,
        }),
      );

      // Try to extend first assignment to overlap with second
      await expect(service.update(TENANT_ID, first.id, { endDate: '2024-08-01' })).rejects.toThrow(
        ConflictError,
      );
    });

    it('should throw BusinessRuleError when allocation update exceeds 100%', async () => {
      const inst1 = uuid();
      const inst2 = uuid();

      await service.create(
        TENANT_ID,
        validAssignmentInput({
          allocationPercentage: 60,
          institutionId: inst1,
        }),
      );

      const second = await service.create(
        TENANT_ID,
        validAssignmentInput({
          allocationPercentage: 30,
          institutionId: inst2,
          subjectId: uuid(),
        }),
      );

      // Try to increase second assignment to 50% (total would be 110%)
      await expect(
        service.update(TENANT_ID, second.id, { allocationPercentage: 50 }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should allow allocation update that keeps total at or below 100%', async () => {
      const inst1 = uuid();
      const inst2 = uuid();

      await service.create(
        TENANT_ID,
        validAssignmentInput({
          allocationPercentage: 60,
          institutionId: inst1,
        }),
      );

      const second = await service.create(
        TENANT_ID,
        validAssignmentInput({
          allocationPercentage: 20,
          institutionId: inst2,
          subjectId: uuid(),
        }),
      );

      // Increase to 40% (total = 100%)
      const updated = await service.update(TENANT_ID, second.id, { allocationPercentage: 40 });
      expect(updated.allocationPercentage).toBe(40);
    });

    it('should throw BusinessRuleError when end date is before start date on update', async () => {
      const created = await service.create(
        TENANT_ID,
        validAssignmentInput({
          startDate: '2024-01-01',
          endDate: '2024-06-30',
        }),
      );

      await expect(
        service.update(TENANT_ID, created.id, { endDate: '2023-12-01' }),
      ).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('getById', () => {
    it('should return an assignment by ID', async () => {
      const input = validAssignmentInput();
      const created = await service.create(TENANT_ID, input);

      const found = await service.getById(TENANT_ID, created.id);

      expect(found).toBeDefined();
      expect(found.id).toBe(created.id);
      expect(found.staffId).toBe(input.staffId);
    });

    it('should throw NotFoundError when assignment does not exist', async () => {
      const fakeId = uuid();
      await expect(service.getById(TENANT_ID, fakeId)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when assignment belongs to different tenant', async () => {
      const input = validAssignmentInput();
      const created = await service.create(TENANT_ID, input);

      const otherTenantId = uuid();
      await expect(service.getById(otherTenantId, created.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('should return paginated results', async () => {
      for (let i = 0; i < 5; i++) {
        await service.create(
          TENANT_ID,
          validAssignmentInput({
            institutionId: uuid(),
            subjectId: uuid(),
            classId: uuid(),
            allocationPercentage: 10,
          }),
        );
      }

      const result = await service.list(TENANT_ID, {}, { page: 1, pageSize: 3 });

      expect(result.data).toHaveLength(3);
      expect(result.meta.totalItems).toBe(5);
      expect(result.meta.totalPages).toBe(2);
    });

    it('should filter by staffId', async () => {
      const otherStaffId = uuid();

      await service.create(
        TENANT_ID,
        validAssignmentInput({
          staffId: STAFF_ID,
          allocationPercentage: 30,
        }),
      );
      await service.create(
        TENANT_ID,
        validAssignmentInput({
          staffId: otherStaffId,
          institutionId: uuid(),
          subjectId: uuid(),
          allocationPercentage: 30,
        }),
      );

      const result = await service.list(
        TENANT_ID,
        { staffId: STAFF_ID },
        { page: 1, pageSize: 20 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.staffId).toBe(STAFF_ID);
    });

    it('should filter by institutionId', async () => {
      const inst1 = uuid();
      const inst2 = uuid();

      await service.create(
        TENANT_ID,
        validAssignmentInput({
          institutionId: inst1,
          allocationPercentage: 30,
        }),
      );
      await service.create(
        TENANT_ID,
        validAssignmentInput({
          institutionId: inst2,
          subjectId: uuid(),
          allocationPercentage: 30,
        }),
      );

      const result = await service.list(
        TENANT_ID,
        { institutionId: inst1 },
        { page: 1, pageSize: 20 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.institutionId).toBe(inst1);
    });

    it('should filter by status', async () => {
      const assignment = await service.create(
        TENANT_ID,
        validAssignmentInput({
          allocationPercentage: 30,
        }),
      );
      await service.create(
        TENANT_ID,
        validAssignmentInput({
          institutionId: uuid(),
          subjectId: uuid(),
          allocationPercentage: 30,
        }),
      );

      // Deactivate first
      await service.update(TENANT_ID, assignment.id, { status: 'INACTIVE' });

      const result = await service.list(TENANT_ID, { status: 'ACTIVE' }, { page: 1, pageSize: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.status).toBe('ACTIVE');
    });
  });

  describe('delete', () => {
    it('should delete an assignment', async () => {
      const input = validAssignmentInput();
      const created = await service.create(TENANT_ID, input);

      await service.delete(TENANT_ID, created.id);

      await expect(service.getById(TENANT_ID, created.id)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when assignment does not exist', async () => {
      const fakeId = uuid();
      await expect(service.delete(TENANT_ID, fakeId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('getTotalAllocation', () => {
    it('should return total allocation for a staff member', async () => {
      await service.create(
        TENANT_ID,
        validAssignmentInput({
          allocationPercentage: 40,
          institutionId: uuid(),
        }),
      );
      await service.create(
        TENANT_ID,
        validAssignmentInput({
          allocationPercentage: 30,
          institutionId: uuid(),
          subjectId: uuid(),
        }),
      );

      const total = await service.getTotalAllocation(TENANT_ID, STAFF_ID);
      expect(total).toBe(70);
    });

    it('should return 0 when staff has no active assignments', async () => {
      const total = await service.getTotalAllocation(TENANT_ID, STAFF_ID);
      expect(total).toBe(0);
    });

    it('should not count inactive assignments', async () => {
      const assignment = await service.create(
        TENANT_ID,
        validAssignmentInput({
          allocationPercentage: 50,
        }),
      );

      await service.update(TENANT_ID, assignment.id, { status: 'INACTIVE' });

      const total = await service.getTotalAllocation(TENANT_ID, STAFF_ID);
      expect(total).toBe(0);
    });
  });
});
