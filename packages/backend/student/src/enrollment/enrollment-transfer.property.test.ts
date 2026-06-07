/**
 * Property-based tests for Student Transfer and Enrollment History.
 *
 * Property 11: Student Transfer State Consistency
 * For any valid student transfer between institutions, the source enrollment
 * status SHALL transition to "transferred", the destination enrollment status
 * SHALL be "enrolled", and a transfer record SHALL link both institutions with
 * the transfer date and reason.
 *
 * Property 12: Student Transfer Destination Validation
 * For any student transfer referencing a destination institution that does not
 * exist or has inactive status, the system SHALL reject the transfer with an
 * error indicating the invalid destination.
 *
 * Property 13: Enrollment Status History Completeness
 * For any enrollment status change, a history entry SHALL be created containing
 * the previous status, new status, effective date, institution, academic period,
 * and reason for change.
 *
 * **Validates: Requirements 6.2, 6.3, 6.4**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { BusinessRuleError, EnrollmentStatus } from '@proctira/common';

import { InMemoryEnrollmentRepository } from './in-memory-enrollment-repository.js';
import { EnrollmentService } from './enrollment-service.js';
import type { CreateEnrollmentInput, StudentTransferInput } from './schemas.js';

// --- Arbitraries ---

/**
 * Generates a valid UUID v4 string.
 */
const uuidArb: fc.Arbitrary<string> = fc.uuid().map((u) => u.toLowerCase());

/**
 * Generates a valid ISO date string (YYYY-MM-DD) within a reasonable range.
 */
const isoDateArb: fc.Arbitrary<string> = fc
  .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') })
  .map((d) => d.toISOString().slice(0, 10));

/**
 * Generates a non-empty reason string (1–500 chars).
 */
const reasonArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '.split(''),
  ),
  { minLength: 1, maxLength: 100 },
);

/**
 * Generates a valid institution status that is NOT active (for rejection tests).
 */
const inactiveStatusArb: fc.Arbitrary<string> = fc.constantFrom(
  'inactive',
  'INACTIVE',
  'closed',
  'suspended',
);

/**
 * Generates a valid active institution status.
 */
const activeStatusArb: fc.Arbitrary<string> = fc.constantFrom('active', 'ACTIVE');

/**
 * Generates a complete set of IDs needed for a transfer scenario.
 */
const transferScenarioArb = fc.record({
  tenantId: uuidArb,
  studentId: uuidArb,
  sourceInstitutionId: uuidArb,
  destinationInstitutionId: uuidArb,
  gradeId: uuidArb,
  classId: uuidArb,
  destinationGradeId: uuidArb,
  destinationClassId: uuidArb,
  academicPeriodId: uuidArb,
  enrolledAt: isoDateArb,
  transferDate: isoDateArb,
  reason: reasonArb,
});

// --- Property 11: Student Transfer State Consistency ---

describe('Property 11: Student Transfer State Consistency', () => {
  // **Validates: Requirements 6.3**

  it('after any valid transfer, source enrollment is TRANSFERRED and destination enrollment is ENROLLED', async () => {
    await fc.assert(
      fc.asyncProperty(transferScenarioArb, async (scenario) => {
        const repository = new InMemoryEnrollmentRepository();
        const service = new EnrollmentService(repository);

        // Set up active institutions
        repository.addInstitution(scenario.sourceInstitutionId, scenario.tenantId, 'active');
        repository.addInstitution(scenario.destinationInstitutionId, scenario.tenantId, 'active');

        // Create initial enrollment at source
        const createInput: CreateEnrollmentInput = {
          studentId: scenario.studentId,
          institutionId: scenario.sourceInstitutionId,
          gradeId: scenario.gradeId,
          classId: scenario.classId,
          academicPeriodId: scenario.academicPeriodId,
          enrolledAt: scenario.enrolledAt,
        };
        const enrollment = await service.createEnrollment(scenario.tenantId, createInput);

        // Perform transfer
        const transferInput: StudentTransferInput = {
          studentId: scenario.studentId,
          sourceEnrollmentId: enrollment.id,
          destinationInstitutionId: scenario.destinationInstitutionId,
          destinationGradeId: scenario.destinationGradeId,
          destinationClassId: scenario.destinationClassId,
          academicPeriodId: scenario.academicPeriodId,
          transferDate: scenario.transferDate,
          reason: scenario.reason,
        };
        const result = await service.transferStudent(scenario.tenantId, transferInput);

        // Property: source enrollment status MUST be TRANSFERRED
        expect(result.sourceEnrollment.status).toBe(EnrollmentStatus.TRANSFERRED);

        // Property: destination enrollment status MUST be ENROLLED
        expect(result.destinationEnrollment.status).toBe(EnrollmentStatus.ENROLLED);
      }),
      { numRuns: 100 },
    );
  });

  it('transfer record links source and destination institutions with correct date and reason', async () => {
    await fc.assert(
      fc.asyncProperty(transferScenarioArb, async (scenario) => {
        const repository = new InMemoryEnrollmentRepository();
        const service = new EnrollmentService(repository);

        // Set up active institutions
        repository.addInstitution(scenario.sourceInstitutionId, scenario.tenantId, 'active');
        repository.addInstitution(scenario.destinationInstitutionId, scenario.tenantId, 'active');

        // Create initial enrollment
        const createInput: CreateEnrollmentInput = {
          studentId: scenario.studentId,
          institutionId: scenario.sourceInstitutionId,
          gradeId: scenario.gradeId,
          classId: scenario.classId,
          academicPeriodId: scenario.academicPeriodId,
          enrolledAt: scenario.enrolledAt,
        };
        const enrollment = await service.createEnrollment(scenario.tenantId, createInput);

        // Perform transfer
        const transferInput: StudentTransferInput = {
          studentId: scenario.studentId,
          sourceEnrollmentId: enrollment.id,
          destinationInstitutionId: scenario.destinationInstitutionId,
          destinationGradeId: scenario.destinationGradeId,
          destinationClassId: scenario.destinationClassId,
          academicPeriodId: scenario.academicPeriodId,
          transferDate: scenario.transferDate,
          reason: scenario.reason,
        };
        const result = await service.transferStudent(scenario.tenantId, transferInput);

        // Property: transfer record links correct institutions
        expect(result.transferRecord.sourceInstitutionId).toBe(scenario.sourceInstitutionId);
        expect(result.transferRecord.destinationInstitutionId).toBe(scenario.destinationInstitutionId);

        // Property: transfer record has correct date
        expect(result.transferRecord.transferDate).toEqual(new Date(scenario.transferDate));

        // Property: transfer record has correct reason
        expect(result.transferRecord.reason).toBe(scenario.reason);

        // Property: transfer record links correct student
        expect(result.transferRecord.studentId).toBe(scenario.studentId);

        // Property: transfer record links source and destination enrollments
        expect(result.transferRecord.sourceEnrollmentId).toBe(enrollment.id);
        expect(result.transferRecord.destinationEnrollmentId).toBe(result.destinationEnrollment.id);
      }),
      { numRuns: 100 },
    );
  });

  it('destination enrollment is at the correct institution with correct student and period', async () => {
    await fc.assert(
      fc.asyncProperty(transferScenarioArb, async (scenario) => {
        const repository = new InMemoryEnrollmentRepository();
        const service = new EnrollmentService(repository);

        repository.addInstitution(scenario.sourceInstitutionId, scenario.tenantId, 'active');
        repository.addInstitution(scenario.destinationInstitutionId, scenario.tenantId, 'active');

        const createInput: CreateEnrollmentInput = {
          studentId: scenario.studentId,
          institutionId: scenario.sourceInstitutionId,
          gradeId: scenario.gradeId,
          classId: scenario.classId,
          academicPeriodId: scenario.academicPeriodId,
          enrolledAt: scenario.enrolledAt,
        };
        const enrollment = await service.createEnrollment(scenario.tenantId, createInput);

        const transferInput: StudentTransferInput = {
          studentId: scenario.studentId,
          sourceEnrollmentId: enrollment.id,
          destinationInstitutionId: scenario.destinationInstitutionId,
          destinationGradeId: scenario.destinationGradeId,
          destinationClassId: scenario.destinationClassId,
          academicPeriodId: scenario.academicPeriodId,
          transferDate: scenario.transferDate,
          reason: scenario.reason,
        };
        const result = await service.transferStudent(scenario.tenantId, transferInput);

        // Property: destination enrollment belongs to the correct student
        expect(result.destinationEnrollment.studentId).toBe(scenario.studentId);

        // Property: destination enrollment is at the destination institution
        expect(result.destinationEnrollment.institutionId).toBe(scenario.destinationInstitutionId);

        // Property: destination enrollment uses the specified academic period
        expect(result.destinationEnrollment.academicPeriodId).toBe(scenario.academicPeriodId);

        // Property: destination enrollment uses the specified grade
        expect(result.destinationEnrollment.gradeId).toBe(scenario.destinationGradeId);
      }),
      { numRuns: 100 },
    );
  });
});

// --- Property 12: Student Transfer Destination Validation ---

describe('Property 12: Student Transfer Destination Validation', () => {
  // **Validates: Requirements 6.4**

  it('transfers to non-existent institutions are always rejected with BusinessRuleError', async () => {
    await fc.assert(
      fc.asyncProperty(
        transferScenarioArb,
        uuidArb, // non-existent destination ID
        async (scenario, nonExistentDestId) => {
          const repository = new InMemoryEnrollmentRepository();
          const service = new EnrollmentService(repository);

          // Only add source institution (destination does NOT exist)
          repository.addInstitution(scenario.sourceInstitutionId, scenario.tenantId, 'active');

          // Create initial enrollment
          const createInput: CreateEnrollmentInput = {
            studentId: scenario.studentId,
            institutionId: scenario.sourceInstitutionId,
            gradeId: scenario.gradeId,
            classId: scenario.classId,
            academicPeriodId: scenario.academicPeriodId,
            enrolledAt: scenario.enrolledAt,
          };
          const enrollment = await service.createEnrollment(scenario.tenantId, createInput);

          // Attempt transfer to non-existent institution
          const transferInput: StudentTransferInput = {
            studentId: scenario.studentId,
            sourceEnrollmentId: enrollment.id,
            destinationInstitutionId: nonExistentDestId,
            destinationGradeId: scenario.destinationGradeId,
            destinationClassId: scenario.destinationClassId,
            academicPeriodId: scenario.academicPeriodId,
            transferDate: scenario.transferDate,
            reason: scenario.reason,
          };

          // Property: transfer MUST be rejected
          await expect(
            service.transferStudent(scenario.tenantId, transferInput),
          ).rejects.toThrow(BusinessRuleError);

          // Property: source enrollment status MUST remain ENROLLED (unchanged)
          const sourceAfter = await service.getEnrollmentById(scenario.tenantId, enrollment.id);
          expect(sourceAfter.status).toBe(EnrollmentStatus.ENROLLED);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('transfers to inactive institutions are always rejected with BusinessRuleError', async () => {
    await fc.assert(
      fc.asyncProperty(
        transferScenarioArb,
        inactiveStatusArb,
        async (scenario, inactiveStatus) => {
          const repository = new InMemoryEnrollmentRepository();
          const service = new EnrollmentService(repository);

          // Add source as active, destination as inactive
          repository.addInstitution(scenario.sourceInstitutionId, scenario.tenantId, 'active');
          repository.addInstitution(
            scenario.destinationInstitutionId,
            scenario.tenantId,
            inactiveStatus,
          );

          // Create initial enrollment
          const createInput: CreateEnrollmentInput = {
            studentId: scenario.studentId,
            institutionId: scenario.sourceInstitutionId,
            gradeId: scenario.gradeId,
            classId: scenario.classId,
            academicPeriodId: scenario.academicPeriodId,
            enrolledAt: scenario.enrolledAt,
          };
          const enrollment = await service.createEnrollment(scenario.tenantId, createInput);

          // Attempt transfer to inactive institution
          const transferInput: StudentTransferInput = {
            studentId: scenario.studentId,
            sourceEnrollmentId: enrollment.id,
            destinationInstitutionId: scenario.destinationInstitutionId,
            destinationGradeId: scenario.destinationGradeId,
            destinationClassId: scenario.destinationClassId,
            academicPeriodId: scenario.academicPeriodId,
            transferDate: scenario.transferDate,
            reason: scenario.reason,
          };

          // Property: transfer MUST be rejected
          await expect(
            service.transferStudent(scenario.tenantId, transferInput),
          ).rejects.toThrow(BusinessRuleError);

          // Property: source enrollment status MUST remain ENROLLED (unchanged)
          const sourceAfter = await service.getEnrollmentById(scenario.tenantId, enrollment.id);
          expect(sourceAfter.status).toBe(EnrollmentStatus.ENROLLED);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejected transfers do not create transfer records', async () => {
    await fc.assert(
      fc.asyncProperty(
        transferScenarioArb,
        inactiveStatusArb,
        async (scenario, inactiveStatus) => {
          const repository = new InMemoryEnrollmentRepository();
          const service = new EnrollmentService(repository);

          repository.addInstitution(scenario.sourceInstitutionId, scenario.tenantId, 'active');
          repository.addInstitution(
            scenario.destinationInstitutionId,
            scenario.tenantId,
            inactiveStatus,
          );

          const createInput: CreateEnrollmentInput = {
            studentId: scenario.studentId,
            institutionId: scenario.sourceInstitutionId,
            gradeId: scenario.gradeId,
            classId: scenario.classId,
            academicPeriodId: scenario.academicPeriodId,
            enrolledAt: scenario.enrolledAt,
          };
          const enrollment = await service.createEnrollment(scenario.tenantId, createInput);

          const transferInput: StudentTransferInput = {
            studentId: scenario.studentId,
            sourceEnrollmentId: enrollment.id,
            destinationInstitutionId: scenario.destinationInstitutionId,
            destinationGradeId: scenario.destinationGradeId,
            destinationClassId: scenario.destinationClassId,
            academicPeriodId: scenario.academicPeriodId,
            transferDate: scenario.transferDate,
            reason: scenario.reason,
          };

          // Attempt transfer (should fail)
          try {
            await service.transferStudent(scenario.tenantId, transferInput);
          } catch {
            // Expected
          }

          // Property: no transfer records should exist
          const transfers = await service.getStudentTransferRecords(
            scenario.tenantId,
            scenario.studentId,
          );
          expect(transfers).toHaveLength(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 13: Enrollment Status History Completeness ---

describe('Property 13: Enrollment Status History Completeness', () => {
  // **Validates: Requirements 6.2**

  it('every enrollment creation produces a history entry with correct fields', async () => {
    await fc.assert(
      fc.asyncProperty(
        transferScenarioArb,
        async (scenario) => {
          const repository = new InMemoryEnrollmentRepository();
          const service = new EnrollmentService(repository);

          repository.addInstitution(scenario.sourceInstitutionId, scenario.tenantId, 'active');

          const createInput: CreateEnrollmentInput = {
            studentId: scenario.studentId,
            institutionId: scenario.sourceInstitutionId,
            gradeId: scenario.gradeId,
            classId: scenario.classId,
            academicPeriodId: scenario.academicPeriodId,
            enrolledAt: scenario.enrolledAt,
          };
          const enrollment = await service.createEnrollment(scenario.tenantId, createInput);

          // Get history for the enrollment
          const history = await repository.getHistoryByEnrollmentId(enrollment.id);

          // Property: at least one history entry exists
          expect(history.length).toBeGreaterThanOrEqual(1);

          // Find the initial enrollment entry
          const initialEntry = history.find((h) => h.newStatus === EnrollmentStatus.ENROLLED);
          expect(initialEntry).toBeDefined();

          // Property: history entry contains all required fields
          expect(initialEntry!.enrollmentId).toBe(enrollment.id);
          expect(initialEntry!.previousStatus).toBeNull(); // first enrollment has no previous
          expect(initialEntry!.newStatus).toBe(EnrollmentStatus.ENROLLED);
          expect(initialEntry!.effectiveDate).toEqual(new Date(scenario.enrolledAt));
          expect(initialEntry!.institutionId).toBe(scenario.sourceInstitutionId);
          expect(initialEntry!.academicPeriodId).toBe(scenario.academicPeriodId);
          expect(initialEntry!.reason).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('every status change (withdraw/graduate) produces a complete history entry', async () => {
    const statusChangeArb = fc.record({
      tenantId: uuidArb,
      studentId: uuidArb,
      institutionId: uuidArb,
      gradeId: uuidArb,
      classId: uuidArb,
      academicPeriodId: uuidArb,
      enrolledAt: isoDateArb,
      effectiveDate: isoDateArb,
      reason: reasonArb,
      newStatus: fc.constantFrom('WITHDRAWN' as const, 'GRADUATED' as const),
    });

    await fc.assert(
      fc.asyncProperty(statusChangeArb, async (scenario) => {
        const repository = new InMemoryEnrollmentRepository();
        const service = new EnrollmentService(repository);

        repository.addInstitution(scenario.institutionId, scenario.tenantId, 'active');

        // Create enrollment
        const createInput: CreateEnrollmentInput = {
          studentId: scenario.studentId,
          institutionId: scenario.institutionId,
          gradeId: scenario.gradeId,
          classId: scenario.classId,
          academicPeriodId: scenario.academicPeriodId,
          enrolledAt: scenario.enrolledAt,
        };
        const enrollment = await service.createEnrollment(scenario.tenantId, createInput);

        // Change status
        await service.updateEnrollmentStatus(scenario.tenantId, enrollment.id, {
          status: scenario.newStatus,
          reason: scenario.reason,
          effectiveDate: scenario.effectiveDate,
        });

        // Get history
        const history = await repository.getHistoryByEnrollmentId(enrollment.id);

        // Property: should have 2 entries (initial + status change)
        expect(history).toHaveLength(2);

        // Find the status change entry (not the initial enrollment)
        const changeEntry = history.find((h) => h.newStatus === scenario.newStatus);
        expect(changeEntry).toBeDefined();

        // Property: history entry contains previous status
        expect(changeEntry!.previousStatus).toBe(EnrollmentStatus.ENROLLED);

        // Property: history entry contains new status
        expect(changeEntry!.newStatus).toBe(scenario.newStatus);

        // Property: history entry contains effective date
        expect(changeEntry!.effectiveDate).toEqual(new Date(scenario.effectiveDate));

        // Property: history entry contains institution
        expect(changeEntry!.institutionId).toBe(scenario.institutionId);

        // Property: history entry contains academic period
        expect(changeEntry!.academicPeriodId).toBe(scenario.academicPeriodId);

        // Property: history entry contains reason
        expect(changeEntry!.reason).toBe(scenario.reason);
      }),
      { numRuns: 100 },
    );
  });

  it('transfer produces history entries for both source (TRANSFERRED) and destination (ENROLLED)', async () => {
    await fc.assert(
      fc.asyncProperty(transferScenarioArb, async (scenario) => {
        const repository = new InMemoryEnrollmentRepository();
        const service = new EnrollmentService(repository);

        repository.addInstitution(scenario.sourceInstitutionId, scenario.tenantId, 'active');
        repository.addInstitution(scenario.destinationInstitutionId, scenario.tenantId, 'active');

        // Create initial enrollment
        const createInput: CreateEnrollmentInput = {
          studentId: scenario.studentId,
          institutionId: scenario.sourceInstitutionId,
          gradeId: scenario.gradeId,
          classId: scenario.classId,
          academicPeriodId: scenario.academicPeriodId,
          enrolledAt: scenario.enrolledAt,
        };
        const enrollment = await service.createEnrollment(scenario.tenantId, createInput);

        // Perform transfer
        const transferInput: StudentTransferInput = {
          studentId: scenario.studentId,
          sourceEnrollmentId: enrollment.id,
          destinationInstitutionId: scenario.destinationInstitutionId,
          destinationGradeId: scenario.destinationGradeId,
          destinationClassId: scenario.destinationClassId,
          academicPeriodId: scenario.academicPeriodId,
          transferDate: scenario.transferDate,
          reason: scenario.reason,
        };
        const result = await service.transferStudent(scenario.tenantId, transferInput);

        // Check source enrollment history
        const sourceHistory = await repository.getHistoryByEnrollmentId(enrollment.id);

        // Property: source has history entry for TRANSFERRED
        const transferOutEntry = sourceHistory.find(
          (h) => h.newStatus === EnrollmentStatus.TRANSFERRED,
        );
        expect(transferOutEntry).toBeDefined();
        expect(transferOutEntry!.previousStatus).toBe(EnrollmentStatus.ENROLLED);
        expect(transferOutEntry!.effectiveDate).toEqual(new Date(scenario.transferDate));
        expect(transferOutEntry!.institutionId).toBe(scenario.sourceInstitutionId);
        expect(transferOutEntry!.academicPeriodId).toBe(scenario.academicPeriodId);
        expect(transferOutEntry!.reason).toBe(scenario.reason);

        // Check destination enrollment history
        const destHistory = await repository.getHistoryByEnrollmentId(
          result.destinationEnrollment.id,
        );

        // Property: destination has history entry for ENROLLED
        const transferInEntry = destHistory.find(
          (h) => h.newStatus === EnrollmentStatus.ENROLLED,
        );
        expect(transferInEntry).toBeDefined();
        expect(transferInEntry!.previousStatus).toBeNull();
        expect(transferInEntry!.effectiveDate).toEqual(new Date(scenario.transferDate));
        expect(transferInEntry!.institutionId).toBe(scenario.destinationInstitutionId);
        expect(transferInEntry!.academicPeriodId).toBe(scenario.academicPeriodId);
        expect(transferInEntry!.reason).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });
});
