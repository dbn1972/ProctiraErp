/**
 * Property-Based Test: Examination Eligibility Validation
 *
 * **Validates: Requirements 10.2, 10.3**
 *
 * Property 23: For any candidate submitted for examination registration,
 * the Examination_Module SHALL:
 * 1. Accept students with active enrollment ('enrolled') AND all prerequisite subjects completed
 * 2. Reject students without active enrollment with error indicating enrollment status issue
 * 3. Reject students missing prerequisite subjects with error listing the missing subjects
 * 4. When both conditions fail, report both failures in the error
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ValidationError } from '@proctira/common';

import { ExaminationService } from './examination-service.js';
import { InMemoryExaminationRepository } from './in-memory-repository.js';
import type { ExaminationEntity, StudentEnrollment } from './examination-repository.js';
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

// Arbitrary for non-enrolled statuses
const arbInactiveStatus: fc.Arbitrary<'transferred' | 'withdrawn' | 'graduated'> = fc.constantFrom(
  'transferred',
  'withdrawn',
  'graduated',
);

// Arbitrary for generating subject codes (1-5 subjects)
const arbSubjectCodes: fc.Arbitrary<string[]> = fc
  .integer({ min: 1, max: 5 })
  .chain((count) =>
    fc.array(
      fc.stringMatching(/^[A-Z]{2,6}$/),
      { minLength: count, maxLength: count },
    ),
  )
  .map((codes) => [...new Set(codes)]) // Ensure unique codes
  .filter((codes) => codes.length >= 1); // Must have at least 1

// Arbitrary for generating a non-empty subset of an array
function arbNonEmptySubset<T>(items: T[]): fc.Arbitrary<T[]> {
  if (items.length === 0) return fc.constant([]);
  return fc
    .array(fc.boolean(), { minLength: items.length, maxLength: items.length })
    .map((flags) => items.filter((_, i) => flags[i]))
    .filter((subset) => subset.length > 0 && subset.length < items.length);
}

// Arbitrary for generating a strict subset (missing at least one item)
function arbStrictSubset<T>(items: T[]): fc.Arbitrary<T[]> {
  if (items.length <= 1) return fc.constant([]);
  return fc
    .array(fc.boolean(), { minLength: items.length, maxLength: items.length })
    .map((flags) => items.filter((_, i) => flags[i]))
    .filter((subset) => subset.length < items.length);
}

describe('Property 23: Examination Eligibility Validation', () => {
  let service: ExaminationService;
  let repository: InMemoryExaminationRepository;
  const tenantId = 'tenant-eligibility-test';

  beforeEach(() => {
    repository = new InMemoryExaminationRepository();
    service = new ExaminationService(repository);
  });

  /**
   * Helper to create an examination with given subject codes and return it.
   */
  async function createExamination(subjectCodes: string[]): Promise<ExaminationEntity> {
    const input: CreateExaminationInput = {
      name: 'Eligibility Test Exam',
      code: `EXAM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      description: 'Test examination for eligibility property tests',
      academicPeriodId: uuid(),
      startDate: futureDate(14),
      endDate: futureDate(21),
      subjects: subjectCodes.map((code) => ({
        name: `Subject ${code}`,
        code,
        maxScore: 100,
      })),
      centers: [
        { name: 'Test Center', code: 'CTR-1', institutionId: uuid(), capacity: 200 },
      ],
      gradingSchemes: [
        {
          name: 'Standard',
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
    };

    return service.create(tenantId, input);
  }

  it('students with active enrollment AND all prerequisites completed are always accepted', async () => {
    await fc.assert(
      fc.asyncProperty(arbSubjectCodes, async (subjectCodes) => {
        // Create examination with the generated subject codes
        const exam = await createExamination(subjectCodes);
        const studentId = `student-${uuid()}`;

        // Set up student with active enrollment and ALL prerequisite subjects completed
        repository.setStudentEnrollment({
          studentId,
          status: 'enrolled',
          institutionId: uuid(),
          completedSubjectCodes: subjectCodes, // All exam subjects completed
        });

        // Registration should succeed
        const result = await service.registerCandidate(tenantId, exam.id, {
          studentId,
          centerId: exam.centers[0]!.id,
          subjectIds: [exam.subjects[0]!.id],
        });

        expect(result.status).toBe('REGISTERED');
        expect(result.studentId).toBe(studentId);
        expect(result.examinationId).toBe(exam.id);
      }),
      { numRuns: 50 },
    );
  });

  it('students without active enrollment are always rejected with enrollment status error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSubjectCodes,
        arbInactiveStatus,
        async (subjectCodes, inactiveStatus) => {
          // Create examination
          const exam = await createExamination(subjectCodes);
          const studentId = `student-${uuid()}`;

          // Set up student with inactive enrollment but all subjects completed
          repository.setStudentEnrollment({
            studentId,
            status: inactiveStatus,
            institutionId: uuid(),
            completedSubjectCodes: subjectCodes, // All subjects completed
          });

          // Registration should be rejected
          try {
            await service.registerCandidate(tenantId, exam.id, {
              studentId,
              centerId: exam.centers[0]!.id,
              subjectIds: [exam.subjects[0]!.id],
            });
            // Should not reach here
            expect.fail('Expected ValidationError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
            const validationError = error as ValidationError;
            const json = validationError.toJSON();

            // Must have enrollment status error
            expect(json.errors).toBeDefined();
            const enrollmentError = json.errors!.find(
              (e: any) => e.field === 'enrollmentStatus',
            );
            expect(enrollmentError).toBeDefined();
            expect(enrollmentError!.rule).toBe('activeEnrollment');
            // Error message should indicate the actual status
            expect(enrollmentError!.message).toContain(inactiveStatus);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('students missing prerequisite subjects are always rejected with error listing missing subjects', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSubjectCodes.filter((codes) => codes.length >= 2),
        async (subjectCodes) => {
          // Create examination
          const exam = await createExamination(subjectCodes);
          const studentId = `student-${uuid()}`;

          // Generate a strict subset of completed subjects (missing at least one)
          // We'll complete all but the last subject
          const completedCodes = subjectCodes.slice(0, -1);
          const missingCodes = subjectCodes.slice(-1);

          // Set up student with active enrollment but missing some prerequisites
          repository.setStudentEnrollment({
            studentId,
            status: 'enrolled',
            institutionId: uuid(),
            completedSubjectCodes: completedCodes,
          });

          // Registration should be rejected
          try {
            await service.registerCandidate(tenantId, exam.id, {
              studentId,
              centerId: exam.centers[0]!.id,
              subjectIds: [exam.subjects[0]!.id],
            });
            expect.fail('Expected ValidationError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
            const validationError = error as ValidationError;
            const json = validationError.toJSON();

            // Must have prerequisite subjects error
            expect(json.errors).toBeDefined();
            const prereqError = json.errors!.find(
              (e: any) => e.field === 'prerequisiteSubjects',
            );
            expect(prereqError).toBeDefined();
            expect(prereqError!.rule).toBe('prerequisiteCompletion');

            // Error message should list the missing subjects
            for (const missingCode of missingCodes) {
              expect(prereqError!.message).toContain(missingCode);
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('when both enrollment and prerequisites fail, both failures are reported in the error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSubjectCodes.filter((codes) => codes.length >= 2),
        arbInactiveStatus,
        async (subjectCodes, inactiveStatus) => {
          // Create examination
          const exam = await createExamination(subjectCodes);
          const studentId = `student-${uuid()}`;

          // Generate a strict subset of completed subjects (missing at least one)
          const completedCodes = subjectCodes.slice(0, -1);
          const missingCodes = subjectCodes.slice(-1);

          // Set up student with BOTH inactive enrollment AND missing prerequisites
          repository.setStudentEnrollment({
            studentId,
            status: inactiveStatus,
            institutionId: uuid(),
            completedSubjectCodes: completedCodes,
          });

          // Registration should be rejected
          try {
            await service.registerCandidate(tenantId, exam.id, {
              studentId,
              centerId: exam.centers[0]!.id,
              subjectIds: [exam.subjects[0]!.id],
            });
            expect.fail('Expected ValidationError to be thrown');
          } catch (error) {
            expect(error).toBeInstanceOf(ValidationError);
            const validationError = error as ValidationError;
            const json = validationError.toJSON();

            expect(json.errors).toBeDefined();
            // Must have BOTH errors reported
            const enrollmentError = json.errors!.find(
              (e: any) => e.field === 'enrollmentStatus',
            );
            const prereqError = json.errors!.find(
              (e: any) => e.field === 'prerequisiteSubjects',
            );

            // Enrollment status error must be present
            expect(enrollmentError).toBeDefined();
            expect(enrollmentError!.rule).toBe('activeEnrollment');
            expect(enrollmentError!.message).toContain(inactiveStatus);

            // Prerequisite subjects error must be present
            expect(prereqError).toBeDefined();
            expect(prereqError!.rule).toBe('prerequisiteCompletion');
            for (const missingCode of missingCodes) {
              expect(prereqError!.message).toContain(missingCode);
            }

            // Must have at least 2 errors (both conditions)
            expect(json.errors!.length).toBeGreaterThanOrEqual(2);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
