/**
 * Unit tests for ExaminationService
 *
 * Tests business logic for examination CRUD operations including:
 * - Minimum 1 subject and 1 center enforcement
 * - Exam dates at least 7 days in the future
 * - 1–10 grading schemes with pass threshold validation
 * - Code uniqueness within tenant
 * - Status-based update/delete restrictions
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, BusinessRuleError, ValidationError } from '@proctira/common';

import { ExaminationService, MIN_DAYS_IN_FUTURE } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import type { CreateExaminationInput } from './schemas.js';

// Helper to generate a date N days from now in YYYY-MM-DD format
function futureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0] as string;
}

// Helper to generate a valid UUID v4
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Helper to create a valid examination input
function validExaminationInput(
  overrides: Partial<CreateExaminationInput> = {},
): CreateExaminationInput {
  return {
    name: 'National Examination 2025',
    code: `EXAM-${Date.now()}`,
    description: 'Annual national examination',
    academicPeriodId: uuid(),
    startDate: futureDate(14),
    endDate: futureDate(21),
    subjects: [
      { name: 'Mathematics', code: 'MATH', maxScore: 100 },
      { name: 'English', code: 'ENG', maxScore: 100 },
    ],
    centers: [{ name: 'Center A', code: 'CTR-A', institutionId: uuid(), capacity: 200 }],
    gradingSchemes: [
      {
        name: 'Standard Grading',
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'A', minScore: 80, maxScore: 100 },
          { grade: 'B', minScore: 60, maxScore: 79 },
          { grade: 'C', minScore: 40, maxScore: 59 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ],
      },
    ],
    ...overrides,
  };
}

describe('ExaminationService', () => {
  let service: ExaminationService;
  let repository: InMemoryExaminationRepository;
  const tenantId = uuid();

  beforeEach(() => {
    repository = new InMemoryExaminationRepository();
    service = new ExaminationService(repository);
  });

  describe('create', () => {
    it('should create an examination with valid input', async () => {
      const input = validExaminationInput();
      const result = await service.create(tenantId, input);

      expect(result.id).toBeDefined();
      expect(result.name).toBe(input.name);
      expect(result.code).toBe(input.code);
      expect(result.status).toBe('DRAFT');
      expect(result.subjects).toHaveLength(2);
      expect(result.centers).toHaveLength(1);
      expect(result.gradingSchemes).toHaveLength(1);
      expect(result.tenantId).toBe(tenantId);
    });

    it('should throw ConflictError if code already exists within tenant', async () => {
      const input = validExaminationInput({ code: 'DUPLICATE-CODE' });
      await service.create(tenantId, input);

      await expect(
        service.create(tenantId, validExaminationInput({ code: 'DUPLICATE-CODE' })),
      ).rejects.toThrow(ConflictError);
    });

    it('should throw ValidationError if no subjects provided', async () => {
      const input = validExaminationInput({ subjects: [] as any });

      await expect(service.create(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if no centers provided', async () => {
      const input = validExaminationInput({ centers: [] as any });

      await expect(service.create(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if start date is less than 7 days in the future', async () => {
      const input = validExaminationInput({
        startDate: futureDate(3),
        endDate: futureDate(10),
      });

      await expect(service.create(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if end date is before start date', async () => {
      const input = validExaminationInput({
        startDate: futureDate(14),
        endDate: futureDate(10),
      });

      await expect(service.create(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if more than 10 grading schemes provided', async () => {
      const schemes = Array.from({ length: 11 }, (_, i) => ({
        name: `Scheme ${i}`,
        minScore: 0,
        maxScore: 100,
        passThreshold: 50,
        thresholds: [{ grade: 'P', minScore: 50, maxScore: 100 }],
      }));

      const input = validExaminationInput({ gradingSchemes: schemes });

      await expect(service.create(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if no grading schemes provided', async () => {
      const input = validExaminationInput({ gradingSchemes: [] as any });

      await expect(service.create(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if pass threshold exceeds max score', async () => {
      const input = validExaminationInput({
        gradingSchemes: [
          {
            name: 'Invalid Scheme',
            minScore: 0,
            maxScore: 100,
            passThreshold: 150, // exceeds maxScore
            thresholds: [{ grade: 'P', minScore: 50, maxScore: 100 }],
          },
        ],
      });

      await expect(service.create(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if pass threshold is below min score', async () => {
      const input = validExaminationInput({
        gradingSchemes: [
          {
            name: 'Invalid Scheme',
            minScore: 10,
            maxScore: 100,
            passThreshold: 5, // below minScore
            thresholds: [{ grade: 'P', minScore: 50, maxScore: 100 }],
          },
        ],
      });

      await expect(service.create(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should accept exactly 7 days in the future for start date', async () => {
      const input = validExaminationInput({
        startDate: futureDate(7),
        endDate: futureDate(14),
      });

      const result = await service.create(tenantId, input);
      expect(result.startDate).toBe(input.startDate);
    });

    it('should create examination with sessions', async () => {
      const input = validExaminationInput({
        sessions: [
          {
            subjectId: uuid(),
            date: futureDate(14),
            startTime: '09:00',
            endTime: '12:00',
          },
        ],
      });

      const result = await service.create(tenantId, input);
      expect(result.sessions).toHaveLength(1);
    });

    it('should throw ValidationError if session date is outside exam date range', async () => {
      const input = validExaminationInput({
        startDate: futureDate(14),
        endDate: futureDate(21),
        sessions: [
          {
            subjectId: uuid(),
            date: futureDate(30), // outside range
            startTime: '09:00',
            endTime: '12:00',
          },
        ],
      });

      await expect(service.create(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should throw ValidationError if session end time is before start time', async () => {
      const input = validExaminationInput({
        sessions: [
          {
            subjectId: uuid(),
            date: futureDate(14),
            startTime: '14:00',
            endTime: '09:00', // before start
          },
        ],
      });

      await expect(service.create(tenantId, input)).rejects.toThrow(ValidationError);
    });

    it('should support up to 10 grading schemes', async () => {
      const schemes = Array.from({ length: 10 }, (_, i) => ({
        name: `Scheme ${i + 1}`,
        minScore: 0,
        maxScore: 100,
        passThreshold: 40,
        thresholds: [
          { grade: 'P', minScore: 40, maxScore: 100 },
          { grade: 'F', minScore: 0, maxScore: 39 },
        ],
      }));

      const input = validExaminationInput({ gradingSchemes: schemes });
      const result = await service.create(tenantId, input);
      expect(result.gradingSchemes).toHaveLength(10);
    });
  });

  describe('update', () => {
    it('should update an existing examination', async () => {
      const input = validExaminationInput();
      const created = await service.create(tenantId, input);

      const updated = await service.update(tenantId, created.id, {
        name: 'Updated Examination',
      });

      expect(updated.name).toBe('Updated Examination');
      expect(updated.code).toBe(input.code);
    });

    it('should throw NotFoundError if examination does not exist', async () => {
      await expect(service.update(tenantId, uuid(), { name: 'Test' })).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should throw BusinessRuleError if examination is COMPLETED', async () => {
      const input = validExaminationInput();
      const created = await service.create(tenantId, input);

      // Manually set status to COMPLETED
      await repository.update(created.id, tenantId, { status: 'COMPLETED' });

      await expect(service.update(tenantId, created.id, { name: 'Test' })).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it('should throw BusinessRuleError if examination is CANCELLED', async () => {
      const input = validExaminationInput();
      const created = await service.create(tenantId, input);

      await repository.update(created.id, tenantId, { status: 'CANCELLED' });

      await expect(service.update(tenantId, created.id, { name: 'Test' })).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it('should throw ConflictError if updated code already exists', async () => {
      const input1 = validExaminationInput({ code: 'CODE-1' });
      const input2 = validExaminationInput({ code: 'CODE-2' });
      await service.create(tenantId, input1);
      const exam2 = await service.create(tenantId, input2);

      await expect(service.update(tenantId, exam2.id, { code: 'CODE-1' })).rejects.toThrow(
        ConflictError,
      );
    });

    it('should validate subjects minimum on update', async () => {
      const input = validExaminationInput();
      const created = await service.create(tenantId, input);

      await expect(service.update(tenantId, created.id, { subjects: [] as any })).rejects.toThrow(
        ValidationError,
      );
    });

    it('should validate centers minimum on update', async () => {
      const input = validExaminationInput();
      const created = await service.create(tenantId, input);

      await expect(service.update(tenantId, created.id, { centers: [] as any })).rejects.toThrow(
        ValidationError,
      );
    });
  });

  describe('delete', () => {
    it('should delete a DRAFT examination', async () => {
      const input = validExaminationInput();
      const created = await service.create(tenantId, input);

      await service.delete(tenantId, created.id);

      await expect(service.getById(tenantId, created.id)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError if examination does not exist', async () => {
      await expect(service.delete(tenantId, uuid())).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError if examination is IN_PROGRESS', async () => {
      const input = validExaminationInput();
      const created = await service.create(tenantId, input);

      await repository.update(created.id, tenantId, { status: 'IN_PROGRESS' });

      await expect(service.delete(tenantId, created.id)).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError if examination is COMPLETED', async () => {
      const input = validExaminationInput();
      const created = await service.create(tenantId, input);

      await repository.update(created.id, tenantId, { status: 'COMPLETED' });

      await expect(service.delete(tenantId, created.id)).rejects.toThrow(BusinessRuleError);
    });
  });

  describe('getById', () => {
    it('should return an examination by ID', async () => {
      const input = validExaminationInput();
      const created = await service.create(tenantId, input);

      const result = await service.getById(tenantId, created.id);
      expect(result.id).toBe(created.id);
      expect(result.name).toBe(input.name);
    });

    it('should throw NotFoundError if examination does not exist', async () => {
      await expect(service.getById(tenantId, uuid())).rejects.toThrow(NotFoundError);
    });

    it('should not return examination from different tenant', async () => {
      const input = validExaminationInput();
      const created = await service.create(tenantId, input);

      await expect(service.getById(uuid(), created.id)).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('should list examinations for a tenant', async () => {
      await service.create(tenantId, validExaminationInput({ code: 'E1' }));
      await service.create(tenantId, validExaminationInput({ code: 'E2' }));

      const result = await service.list(tenantId, {}, { page: 1, pageSize: 20 });
      expect(result.data).toHaveLength(2);
      expect(result.meta.totalItems).toBe(2);
    });

    it('should filter by status', async () => {
      const exam = await service.create(tenantId, validExaminationInput({ code: 'E1' }));
      await service.create(tenantId, validExaminationInput({ code: 'E2' }));
      await repository.update(exam.id, tenantId, { status: 'SCHEDULED' });

      const result = await service.list(
        tenantId,
        { status: 'SCHEDULED' },
        { page: 1, pageSize: 20 },
      );
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.status).toBe('SCHEDULED');
    });

    it('should not return examinations from other tenants', async () => {
      const otherTenant = uuid();
      await service.create(tenantId, validExaminationInput({ code: 'E1' }));
      await service.create(otherTenant, validExaminationInput({ code: 'E2' }));

      const result = await service.list(tenantId, {}, { page: 1, pageSize: 20 });
      expect(result.data).toHaveLength(1);
    });
  });

  describe('registerCandidate', () => {
    it('should register an eligible candidate successfully', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);

      // Set up student enrollment with all prerequisite subjects completed
      const subjectCodes = exam.subjects.map((s) => s.code);
      repository.setStudentEnrollment({
        studentId: 'student-1',
        status: 'enrolled',
        institutionId: uuid(),
        completedSubjectCodes: subjectCodes,
      });

      const result = await service.registerCandidate(tenantId, exam.id, {
        studentId: 'student-1',
        centerId: exam.centers[0]!.id,
        subjectIds: [exam.subjects[0]!.id],
      });

      expect(result.id).toBeDefined();
      expect(result.examinationId).toBe(exam.id);
      expect(result.studentId).toBe('student-1');
      expect(result.status).toBe('REGISTERED');
      expect(result.centerId).toBe(exam.centers[0]!.id);
      expect(result.subjectIds).toEqual([exam.subjects[0]!.id]);
    });

    it('should reject candidate with inactive enrollment status (transferred)', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);

      repository.setStudentEnrollment({
        studentId: 'student-2',
        status: 'transferred',
        institutionId: uuid(),
        completedSubjectCodes: exam.subjects.map((s) => s.code),
      });

      await expect(
        service.registerCandidate(tenantId, exam.id, {
          studentId: 'student-2',
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        }),
      ).rejects.toThrow(ValidationError);

      try {
        await service.registerCandidate(tenantId, exam.id, {
          studentId: 'student-2',
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        const json = validationError.toJSON();
        expect(json.errors).toBeDefined();
        expect(json.errors!.some((e: any) => e.field === 'enrollmentStatus')).toBe(true);
        expect(json.errors!.some((e: any) => e.rule === 'activeEnrollment')).toBe(true);
      }
    });

    it('should reject candidate with inactive enrollment status (withdrawn)', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);

      repository.setStudentEnrollment({
        studentId: 'student-3',
        status: 'withdrawn',
        institutionId: uuid(),
        completedSubjectCodes: exam.subjects.map((s) => s.code),
      });

      await expect(
        service.registerCandidate(tenantId, exam.id, {
          studentId: 'student-3',
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject candidate with incomplete prerequisite subjects', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);

      // Student has only completed one of the two required subjects
      repository.setStudentEnrollment({
        studentId: 'student-4',
        status: 'enrolled',
        institutionId: uuid(),
        completedSubjectCodes: ['MATH'], // Missing 'ENG'
      });

      await expect(
        service.registerCandidate(tenantId, exam.id, {
          studentId: 'student-4',
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        }),
      ).rejects.toThrow(ValidationError);

      try {
        await service.registerCandidate(tenantId, exam.id, {
          studentId: 'student-4',
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        const json = validationError.toJSON();
        expect(json.errors).toBeDefined();
        expect(json.errors!.some((e: any) => e.field === 'prerequisiteSubjects')).toBe(true);
        expect(json.errors!.some((e: any) => e.message.includes('ENG'))).toBe(true);
      }
    });

    it('should reject candidate with both inactive enrollment and missing prerequisites', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);

      repository.setStudentEnrollment({
        studentId: 'student-5',
        status: 'graduated',
        institutionId: uuid(),
        completedSubjectCodes: [], // No subjects completed
      });

      try {
        await service.registerCandidate(tenantId, exam.id, {
          studentId: 'student-5',
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        });
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        const json = validationError.toJSON();
        expect(json.errors).toBeDefined();
        // Should report both enrollment status and prerequisite failures
        expect(json.errors!.some((e: any) => e.field === 'enrollmentStatus')).toBe(true);
        expect(json.errors!.some((e: any) => e.field === 'prerequisiteSubjects')).toBe(true);
      }
    });

    it('should reject candidate when student record not found', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);

      // No enrollment set for this student
      await expect(
        service.registerCandidate(tenantId, exam.id, {
          studentId: 'nonexistent-student',
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should throw NotFoundError if examination does not exist', async () => {
      await expect(
        service.registerCandidate(tenantId, uuid(), {
          studentId: 'student-1',
          centerId: uuid(),
          subjectIds: [uuid()],
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw BusinessRuleError if examination is COMPLETED', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);
      await repository.update(exam.id, tenantId, { status: 'COMPLETED' });

      repository.setStudentEnrollment({
        studentId: 'student-6',
        status: 'enrolled',
        institutionId: uuid(),
        completedSubjectCodes: exam.subjects.map((s) => s.code),
      });

      await expect(
        service.registerCandidate(tenantId, exam.id, {
          studentId: 'student-6',
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw BusinessRuleError if examination is IN_PROGRESS', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);
      await repository.update(exam.id, tenantId, { status: 'IN_PROGRESS' });

      repository.setStudentEnrollment({
        studentId: 'student-7',
        status: 'enrolled',
        institutionId: uuid(),
        completedSubjectCodes: exam.subjects.map((s) => s.code),
      });

      await expect(
        service.registerCandidate(tenantId, exam.id, {
          studentId: 'student-7',
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        }),
      ).rejects.toThrow(BusinessRuleError);
    });

    it('should throw ConflictError if candidate is already registered', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);

      repository.setStudentEnrollment({
        studentId: 'student-8',
        status: 'enrolled',
        institutionId: uuid(),
        completedSubjectCodes: exam.subjects.map((s) => s.code),
      });

      // First registration should succeed
      await service.registerCandidate(tenantId, exam.id, {
        studentId: 'student-8',
        centerId: exam.centers[0]!.id,
        subjectIds: [exam.subjects[0]!.id],
      });

      // Second registration should fail
      await expect(
        service.registerCandidate(tenantId, exam.id, {
          studentId: 'student-8',
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        }),
      ).rejects.toThrow(ConflictError);
    });

    it('should reject registration with invalid center for the examination', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);

      repository.setStudentEnrollment({
        studentId: 'student-9',
        status: 'enrolled',
        institutionId: uuid(),
        completedSubjectCodes: exam.subjects.map((s) => s.code),
      });

      await expect(
        service.registerCandidate(tenantId, exam.id, {
          studentId: 'student-9',
          centerId: uuid(), // Invalid center
          subjectIds: [exam.subjects[0]!.id],
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should reject registration with invalid subjects for the examination', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);

      repository.setStudentEnrollment({
        studentId: 'student-10',
        status: 'enrolled',
        institutionId: uuid(),
        completedSubjectCodes: exam.subjects.map((s) => s.code),
      });

      await expect(
        service.registerCandidate(tenantId, exam.id, {
          studentId: 'student-10',
          centerId: exam.centers[0]!.id,
          subjectIds: [uuid()], // Invalid subject
        }),
      ).rejects.toThrow(ValidationError);
    });

    it('should allow registration for SCHEDULED examination', async () => {
      const input = validExaminationInput();
      const exam = await service.create(tenantId, input);
      await repository.update(exam.id, tenantId, { status: 'SCHEDULED' });

      repository.setStudentEnrollment({
        studentId: 'student-11',
        status: 'enrolled',
        institutionId: uuid(),
        completedSubjectCodes: exam.subjects.map((s) => s.code),
      });

      const result = await service.registerCandidate(tenantId, exam.id, {
        studentId: 'student-11',
        centerId: exam.centers[0]!.id,
        subjectIds: [exam.subjects[0]!.id],
      });

      expect(result.status).toBe('REGISTERED');
    });
  });
});
