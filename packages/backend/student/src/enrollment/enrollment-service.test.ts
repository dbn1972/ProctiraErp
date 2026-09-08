/**
 * Unit tests for EnrollmentService.
 *
 * Tests cover:
 * - Create enrollment with status tracking
 * - Record status change as history entry (previous status, new status, date, institution, period, reason)
 * - Student transfer: validate destination institution exists and is active
 * - On transfer: set source to "transferred", create "enrolled" at destination, create transfer record
 *
 * Requirements: 6.2, 6.3, 6.4
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundError, BusinessRuleError } from '@proctira/common';

import { InMemoryEnrollmentRepository } from './in-memory-enrollment-repository.js';
import { EnrollmentService } from './enrollment-service.js';
import type {
  CreateEnrollmentInput,
  StudentTransferInput,
  UpdateEnrollmentStatusInput,
} from './schemas.js';

// Helper to generate valid UUIDs for testing
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const TENANT_ID = uuid();
const STUDENT_ID = uuid();
const INSTITUTION_ID = uuid();
const GRADE_ID = uuid();
const CLASS_ID = uuid();
const ACADEMIC_PERIOD_ID = uuid();

function validCreateInput(overrides: Partial<CreateEnrollmentInput> = {}): CreateEnrollmentInput {
  return {
    studentId: STUDENT_ID,
    institutionId: INSTITUTION_ID,
    gradeId: GRADE_ID,
    classId: CLASS_ID,
    academicPeriodId: ACADEMIC_PERIOD_ID,
    enrolledAt: '2024-01-15',
    ...overrides,
  };
}

describe('EnrollmentService', () => {
  let repository: InMemoryEnrollmentRepository;
  let service: EnrollmentService;

  beforeEach(() => {
    repository = new InMemoryEnrollmentRepository();
    service = new EnrollmentService(repository);
    // Add a default active institution for enrollment
    repository.addInstitution(INSTITUTION_ID, TENANT_ID, 'active');
  });

  describe('createEnrollment', () => {
    it('should create an enrollment with status ENROLLED', async () => {
      const input = validCreateInput();
      const result = await service.createEnrollment(TENANT_ID, input);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.studentId).toBe(STUDENT_ID);
      expect(result.institutionId).toBe(INSTITUTION_ID);
      expect(result.gradeId).toBe(GRADE_ID);
      expect(result.classId).toBe(CLASS_ID);
      expect(result.academicPeriodId).toBe(ACADEMIC_PERIOD_ID);
      expect(result.status).toBe('ENROLLED');
      expect(result.tenantId).toBe(TENANT_ID);
      expect(result.enrolledAt).toEqual(new Date('2024-01-15'));
      expect(result.exitedAt).toBeNull();
    });

    it('should create an initial history entry on enrollment', async () => {
      const input = validCreateInput();
      const enrollment = await service.createEnrollment(TENANT_ID, input);

      const history = await service.getStudentEnrollmentHistory(TENANT_ID, STUDENT_ID);
      expect(history).toHaveLength(1);
      expect(history[0].enrollmentId).toBe(enrollment.id);
      expect(history[0].previousStatus).toBeNull();
      expect(history[0].newStatus).toBe('ENROLLED');
      expect(history[0].institutionId).toBe(INSTITUTION_ID);
      expect(history[0].academicPeriodId).toBe(ACADEMIC_PERIOD_ID);
      expect(history[0].reason).toBe('Initial enrollment');
    });

    it('should throw NotFoundError when institution does not exist', async () => {
      const nonExistentInstitutionId = uuid();
      const input = validCreateInput({ institutionId: nonExistentInstitutionId });

      await expect(service.createEnrollment(TENANT_ID, input)).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError when institution is inactive', async () => {
      const inactiveInstitutionId = uuid();
      repository.addInstitution(inactiveInstitutionId, TENANT_ID, 'inactive');
      const input = validCreateInput({ institutionId: inactiveInstitutionId });

      await expect(service.createEnrollment(TENANT_ID, input)).rejects.toThrow(BusinessRuleError);
      await expect(service.createEnrollment(TENANT_ID, input)).rejects.toThrow(
        'Cannot enroll student at an inactive institution',
      );
    });

    it('should handle enrollment without classId', async () => {
      const input = validCreateInput();
      delete (input as Record<string, unknown>).classId;
      const result = await service.createEnrollment(TENANT_ID, input);

      expect(result.classId).toBeNull();
    });
  });

  describe('updateEnrollmentStatus', () => {
    it('should withdraw an enrolled student', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());

      const statusInput: UpdateEnrollmentStatusInput = {
        status: 'WITHDRAWN',
        reason: 'Family relocation',
        effectiveDate: '2024-06-15',
      };

      const updated = await service.updateEnrollmentStatus(TENANT_ID, enrollment.id, statusInput);

      expect(updated.status).toBe('WITHDRAWN');
      expect(updated.exitedAt).toEqual(new Date('2024-06-15'));
    });

    it('should graduate an enrolled student', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());

      const statusInput: UpdateEnrollmentStatusInput = {
        status: 'GRADUATED',
        reason: 'Completed all requirements',
        effectiveDate: '2024-05-30',
      };

      const updated = await service.updateEnrollmentStatus(TENANT_ID, enrollment.id, statusInput);

      expect(updated.status).toBe('GRADUATED');
      expect(updated.exitedAt).toEqual(new Date('2024-05-30'));
    });

    it('should record a history entry on status change', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());

      const statusInput: UpdateEnrollmentStatusInput = {
        status: 'WITHDRAWN',
        reason: 'Personal reasons',
        effectiveDate: '2024-06-15',
      };

      await service.updateEnrollmentStatus(TENANT_ID, enrollment.id, statusInput);

      const history = await service.getStudentEnrollmentHistory(TENANT_ID, STUDENT_ID);
      // Should have 2 entries: initial enrollment + withdrawal
      expect(history).toHaveLength(2);

      // Most recent first
      const withdrawalEntry = history[0];
      expect(withdrawalEntry.previousStatus).toBe('ENROLLED');
      expect(withdrawalEntry.newStatus).toBe('WITHDRAWN');
      expect(withdrawalEntry.effectiveDate).toEqual(new Date('2024-06-15'));
      expect(withdrawalEntry.institutionId).toBe(INSTITUTION_ID);
      expect(withdrawalEntry.academicPeriodId).toBe(ACADEMIC_PERIOD_ID);
      expect(withdrawalEntry.reason).toBe('Personal reasons');
    });

    it('should throw NotFoundError when enrollment does not exist', async () => {
      const fakeId = uuid();
      const statusInput: UpdateEnrollmentStatusInput = {
        status: 'WITHDRAWN',
        reason: 'Test',
        effectiveDate: '2024-06-15',
      };

      await expect(service.updateEnrollmentStatus(TENANT_ID, fakeId, statusInput)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should throw BusinessRuleError when enrollment is not ENROLLED', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());

      // First withdraw
      await service.updateEnrollmentStatus(TENANT_ID, enrollment.id, {
        status: 'WITHDRAWN',
        reason: 'First withdrawal',
        effectiveDate: '2024-06-15',
      });

      // Try to graduate a withdrawn enrollment
      await expect(
        service.updateEnrollmentStatus(TENANT_ID, enrollment.id, {
          status: 'GRADUATED',
          reason: 'Should fail',
          effectiveDate: '2024-06-20',
        }),
      ).rejects.toThrow(BusinessRuleError);
      await expect(
        service.updateEnrollmentStatus(TENANT_ID, enrollment.id, {
          status: 'GRADUATED',
          reason: 'Should fail',
          effectiveDate: '2024-06-20',
        }),
      ).rejects.toThrow("Cannot change status from 'WITHDRAWN' to 'GRADUATED'");
    });
  });

  describe('transferStudent', () => {
    const DEST_INSTITUTION_ID = uuid();
    const DEST_GRADE_ID = uuid();
    const DEST_CLASS_ID = uuid();

    beforeEach(() => {
      repository.addInstitution(DEST_INSTITUTION_ID, TENANT_ID, 'active');
    });

    function validTransferInput(
      sourceEnrollmentId: string,
      overrides: Partial<StudentTransferInput> = {},
    ): StudentTransferInput {
      return {
        studentId: STUDENT_ID,
        sourceEnrollmentId,
        destinationInstitutionId: DEST_INSTITUTION_ID,
        destinationGradeId: DEST_GRADE_ID,
        destinationClassId: DEST_CLASS_ID,
        academicPeriodId: ACADEMIC_PERIOD_ID,
        transferDate: '2024-03-01',
        reason: 'Family relocation',
        ...overrides,
      };
    }

    it('should transfer a student: set source to TRANSFERRED, create ENROLLED at destination', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());
      const transferInput = validTransferInput(enrollment.id);

      const result = await service.transferStudent(TENANT_ID, transferInput);

      // Source enrollment should be TRANSFERRED
      expect(result.sourceEnrollment.status).toBe('TRANSFERRED');
      expect(result.sourceEnrollment.exitedAt).toEqual(new Date('2024-03-01'));

      // Destination enrollment should be ENROLLED
      expect(result.destinationEnrollment.status).toBe('ENROLLED');
      expect(result.destinationEnrollment.studentId).toBe(STUDENT_ID);
      expect(result.destinationEnrollment.institutionId).toBe(DEST_INSTITUTION_ID);
      expect(result.destinationEnrollment.gradeId).toBe(DEST_GRADE_ID);
      expect(result.destinationEnrollment.classId).toBe(DEST_CLASS_ID);
      expect(result.destinationEnrollment.academicPeriodId).toBe(ACADEMIC_PERIOD_ID);
      expect(result.destinationEnrollment.enrolledAt).toEqual(new Date('2024-03-01'));
      expect(result.destinationEnrollment.exitedAt).toBeNull();
    });

    it('should create a transfer record linking source and destination', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());
      const transferInput = validTransferInput(enrollment.id);

      const result = await service.transferStudent(TENANT_ID, transferInput);

      expect(result.transferRecord).toBeDefined();
      expect(result.transferRecord.studentId).toBe(STUDENT_ID);
      expect(result.transferRecord.sourceInstitutionId).toBe(INSTITUTION_ID);
      expect(result.transferRecord.sourceEnrollmentId).toBe(enrollment.id);
      expect(result.transferRecord.destinationInstitutionId).toBe(DEST_INSTITUTION_ID);
      expect(result.transferRecord.destinationEnrollmentId).toBe(result.destinationEnrollment.id);
      expect(result.transferRecord.transferDate).toEqual(new Date('2024-03-01'));
      expect(result.transferRecord.reason).toBe('Family relocation');
    });

    it('should record history entries for both source and destination', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());
      const transferInput = validTransferInput(enrollment.id);

      await service.transferStudent(TENANT_ID, transferInput);

      const history = await service.getStudentEnrollmentHistory(TENANT_ID, STUDENT_ID);
      // Should have: initial enrollment + transfer out + transfer in
      expect(history).toHaveLength(3);

      // Find the transfer-out entry
      const transferOutEntry = history.find(
        (h) => h.newStatus === 'TRANSFERRED' && h.enrollmentId === enrollment.id,
      );
      expect(transferOutEntry).toBeDefined();
      expect(transferOutEntry!.previousStatus).toBe('ENROLLED');
      expect(transferOutEntry!.newStatus).toBe('TRANSFERRED');
      expect(transferOutEntry!.institutionId).toBe(INSTITUTION_ID);
      expect(transferOutEntry!.reason).toBe('Family relocation');

      // Find the transfer-in entry (new enrollment at destination)
      const transferInEntry = history.find(
        (h) => h.newStatus === 'ENROLLED' && h.institutionId === DEST_INSTITUTION_ID,
      );
      expect(transferInEntry).toBeDefined();
      expect(transferInEntry!.previousStatus).toBeNull();
      expect(transferInEntry!.newStatus).toBe('ENROLLED');
      expect(transferInEntry!.institutionId).toBe(DEST_INSTITUTION_ID);
    });

    it('should reject transfer when destination institution does not exist (Requirement 6.4)', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());
      const nonExistentId = uuid();
      const transferInput = validTransferInput(enrollment.id, {
        destinationInstitutionId: nonExistentId,
      });

      await expect(service.transferStudent(TENANT_ID, transferInput)).rejects.toThrow(
        BusinessRuleError,
      );
      await expect(service.transferStudent(TENANT_ID, transferInput)).rejects.toThrow(
        `Transfer rejected: destination institution with id '${nonExistentId}' does not exist`,
      );
    });

    it('should reject transfer when destination institution is inactive (Requirement 6.4)', async () => {
      const inactiveInstitutionId = uuid();
      repository.addInstitution(inactiveInstitutionId, TENANT_ID, 'inactive');

      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());
      const transferInput = validTransferInput(enrollment.id, {
        destinationInstitutionId: inactiveInstitutionId,
      });

      await expect(service.transferStudent(TENANT_ID, transferInput)).rejects.toThrow(
        BusinessRuleError,
      );
      await expect(service.transferStudent(TENANT_ID, transferInput)).rejects.toThrow(
        'Transfer rejected: destination institution is inactive',
      );
    });

    it('should reject transfer when source enrollment does not exist', async () => {
      const fakeEnrollmentId = uuid();
      const transferInput = validTransferInput(fakeEnrollmentId);

      await expect(service.transferStudent(TENANT_ID, transferInput)).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should reject transfer when source enrollment is not ENROLLED', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());

      // Withdraw the enrollment first
      await service.updateEnrollmentStatus(TENANT_ID, enrollment.id, {
        status: 'WITHDRAWN',
        reason: 'Withdrawn',
        effectiveDate: '2024-02-15',
      });

      const transferInput = validTransferInput(enrollment.id);

      await expect(service.transferStudent(TENANT_ID, transferInput)).rejects.toThrow(
        BusinessRuleError,
      );
      await expect(service.transferStudent(TENANT_ID, transferInput)).rejects.toThrow(
        "Cannot transfer: source enrollment status is 'WITHDRAWN', must be 'ENROLLED'",
      );
    });

    it('should reject transfer when student ID does not match source enrollment', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());
      const differentStudentId = uuid();
      const transferInput = validTransferInput(enrollment.id, {
        studentId: differentStudentId,
      });

      await expect(service.transferStudent(TENANT_ID, transferInput)).rejects.toThrow(
        BusinessRuleError,
      );
      await expect(service.transferStudent(TENANT_ID, transferInput)).rejects.toThrow(
        'Source enrollment does not belong to the specified student',
      );
    });

    it('should store transfer records retrievable by student', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());
      const transferInput = validTransferInput(enrollment.id);

      await service.transferStudent(TENANT_ID, transferInput);

      const transfers = await service.getStudentTransferRecords(TENANT_ID, STUDENT_ID);
      expect(transfers).toHaveLength(1);
      expect(transfers[0].studentId).toBe(STUDENT_ID);
      expect(transfers[0].sourceInstitutionId).toBe(INSTITUTION_ID);
      expect(transfers[0].destinationInstitutionId).toBe(DEST_INSTITUTION_ID);
    });
  });

  describe('getEnrollmentById', () => {
    it('should return an enrollment by ID', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());
      const found = await service.getEnrollmentById(TENANT_ID, enrollment.id);

      expect(found).toBeDefined();
      expect(found.id).toBe(enrollment.id);
    });

    it('should throw NotFoundError when enrollment does not exist', async () => {
      const fakeId = uuid();
      await expect(service.getEnrollmentById(TENANT_ID, fakeId)).rejects.toThrow(NotFoundError);
    });
  });

  describe('listEnrollments', () => {
    it('should return paginated results', async () => {
      // Create 3 enrollments
      for (let i = 0; i < 3; i++) {
        await service.createEnrollment(
          TENANT_ID,
          validCreateInput({ studentId: uuid(), enrolledAt: `2024-0${i + 1}-15` }),
        );
      }

      const result = await service.listEnrollments(TENANT_ID, {}, { page: 1, pageSize: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(3);
      expect(result.meta.totalPages).toBe(2);
    });

    it('should filter by studentId', async () => {
      const studentA = uuid();
      const studentB = uuid();

      await service.createEnrollment(TENANT_ID, validCreateInput({ studentId: studentA }));
      await service.createEnrollment(TENANT_ID, validCreateInput({ studentId: studentB }));

      const result = await service.listEnrollments(
        TENANT_ID,
        { studentId: studentA },
        { page: 1, pageSize: 20 },
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].studentId).toBe(studentA);
    });

    it('should filter by status', async () => {
      const enrollment = await service.createEnrollment(TENANT_ID, validCreateInput());
      await service.createEnrollment(TENANT_ID, validCreateInput({ studentId: uuid() }));

      // Withdraw the first enrollment
      await service.updateEnrollmentStatus(TENANT_ID, enrollment.id, {
        status: 'WITHDRAWN',
        reason: 'Test',
        effectiveDate: '2024-06-15',
      });

      const enrolledResult = await service.listEnrollments(
        TENANT_ID,
        { status: 'ENROLLED' },
        { page: 1, pageSize: 20 },
      );
      const withdrawnResult = await service.listEnrollments(
        TENANT_ID,
        { status: 'WITHDRAWN' },
        { page: 1, pageSize: 20 },
      );

      expect(enrolledResult.data).toHaveLength(1);
      expect(withdrawnResult.data).toHaveLength(1);
      expect(withdrawnResult.data[0].id).toBe(enrollment.id);
    });
  });
});
