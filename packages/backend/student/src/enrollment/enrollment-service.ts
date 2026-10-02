/**
 * Enrollment Service
 *
 * Business logic for enrollment lifecycle and student transfers.
 *
 * Requirements:
 * - 6.2: Track enrollment status (enrolled, transferred, withdrawn, graduated)
 *         and record each status change as a history entry
 * - 6.3: Create transfer record linking source and destination institutions
 *         with transfer date and reason; transition statuses accordingly
 * - 6.4: Reject transfer if destination institution does not exist or is inactive
 */
import {
  AppError,
  NotFoundError,
  BusinessRuleError,
  ConflictError,
  EnrollmentStatus,
} from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  EnrollmentEntity,
  EnrollmentFilter,
  EnrollmentHistoryEntity,
  EnrollmentRepository,
  TransferRecordDetail,
  TransferRecordEntity,
} from './enrollment-repository.js';
import type {
  CreateEnrollmentInput,
  UpdateEnrollmentStatusInput,
  BulkUpdateEnrollmentStatusInput,
  StudentTransferInput,
} from './schemas.js';

/**
 * Internal callers can reach the service without TypeBox route validation.
 * Keep that boundary honest so a missing classId reaches the fail-closed
 * business-rule check below; HTTP callers still use the required schema.
 */
export type CreateEnrollmentCommand = Omit<CreateEnrollmentInput, 'classId'> & {
  classId?: CreateEnrollmentInput['classId'];
};

/**
 * Service handling enrollment lifecycle and transfer business logic.
 */
export class EnrollmentService {
  constructor(private readonly repository: EnrollmentRepository) {}

  /**
   * Create a new enrollment for a student at an institution.
   *
   * Records an initial history entry with status ENROLLED.
   */
  async createEnrollment(
    tenantId: string,
    input: CreateEnrollmentCommand,
  ): Promise<EnrollmentEntity> {
    // Validate institution exists and is active
    const institution = await this.repository.findInstitutionById(input.institutionId, tenantId);
    if (!institution) {
      throw new NotFoundError(`Institution with id '${input.institutionId}' not found`);
    }
    if (institution.status !== 'active' && institution.status !== 'ACTIVE') {
      throw new BusinessRuleError('Cannot enroll student at an inactive institution');
    }

    // W2-SIS-04: section/class placement is an enrollment invariant.
    if (!input.classId) {
      throw new BusinessRuleError(
        'classId is required — students must be placed in a class/section on enrollment',
      );
    }

    await this.assertNoActiveEnrollment(tenantId, input.studentId, input.academicPeriodId);

    const enrollmentId = uuidv4();
    const history = {
      reason: 'Initial enrollment',
      effectiveDate: new Date(input.enrolledAt),
    };
    const enrollment = await this.repository.createEnrollment(
      {
        id: enrollmentId,
        tenantId,
        studentId: input.studentId,
        institutionId: input.institutionId,
        gradeId: input.gradeId,
        classId: input.classId,
        academicPeriodId: input.academicPeriodId,
        status: EnrollmentStatus.ENROLLED,
        enrolledAt: new Date(input.enrolledAt),
        exitedAt: null,
      },
      history,
    );

    // In-memory: write history in-app. Postgres: trigger already wrote via GUCs.
    if (!this.repository.writesHistoryViaDatabase) {
      await this.repository.createHistoryEntry({
        id: uuidv4(),
        tenantId,
        enrollmentId: enrollment.id,
        previousStatus: null,
        newStatus: EnrollmentStatus.ENROLLED,
        effectiveDate: history.effectiveDate,
        institutionId: input.institutionId,
        academicPeriodId: input.academicPeriodId,
        reason: history.reason,
      });
    }

    return enrollment;
  }

  /**
   * Update enrollment status (withdraw or graduate).
   *
   * Requirement 6.2: Record each status change as a history entry containing
   * the previous status, new status, effective date, institution, academic period,
   * and reason for change.
   *
   * @throws NotFoundError if enrollment not found
   * @throws BusinessRuleError if status transition is invalid
   */
  async updateEnrollmentStatus(
    tenantId: string,
    enrollmentId: string,
    input: UpdateEnrollmentStatusInput,
  ): Promise<EnrollmentEntity> {
    const enrollment = await this.repository.findEnrollmentById(enrollmentId, tenantId);
    if (!enrollment) {
      throw new NotFoundError(`Enrollment with id '${enrollmentId}' not found`);
    }

    // Only ENROLLED status can transition to WITHDRAWN or GRADUATED
    if (enrollment.status !== EnrollmentStatus.ENROLLED) {
      throw new BusinessRuleError(
        `Cannot change status from '${enrollment.status}' to '${input.status}'. Only ENROLLED enrollments can be withdrawn or graduated.`,
      );
    }

    const previousStatus = enrollment.status;
    const newStatus = input.status;
    const history = {
      reason: input.reason,
      effectiveDate: new Date(input.effectiveDate),
    };

    const updated = await this.repository.updateEnrollment(
      enrollmentId,
      tenantId,
      {
        status: newStatus,
        exitedAt: new Date(input.effectiveDate),
      },
      history,
      // PRC-L160: compare-and-set so a concurrent withdraw/graduate loses with 409.
      { expectedStatus: EnrollmentStatus.ENROLLED },
    );

    if (!updated) {
      throw new NotFoundError(`Enrollment with id '${enrollmentId}' not found`);
    }

    if (!this.repository.writesHistoryViaDatabase) {
      await this.repository.createHistoryEntry({
        id: uuidv4(),
        tenantId,
        enrollmentId,
        previousStatus,
        newStatus,
        effectiveDate: history.effectiveDate,
        institutionId: enrollment.institutionId,
        academicPeriodId: enrollment.academicPeriodId,
        reason: history.reason,
      });
    }

    return updated;
  }

  /**
   * Wave 11 — bulk withdraw / graduate. Per-id results; one failure does not
   * roll back siblings (registrar can retry the failed subset).
   */
  async bulkUpdateEnrollmentStatus(
    tenantId: string,
    input: BulkUpdateEnrollmentStatusInput,
  ): Promise<{
    updated: EnrollmentEntity[];
    failed: Array<{ enrollmentId: string; code: string; message: string }>;
  }> {
    const updated: EnrollmentEntity[] = [];
    const failed: Array<{ enrollmentId: string; code: string; message: string }> = [];
    const seen = new Set<string>();

    for (const enrollmentId of input.enrollmentIds) {
      if (seen.has(enrollmentId)) continue;
      seen.add(enrollmentId);
      try {
        const row = await this.updateEnrollmentStatus(tenantId, enrollmentId, {
          status: input.status,
          reason: input.reason,
          effectiveDate: input.effectiveDate,
        });
        updated.push(row);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          failed.push({
            enrollmentId,
            code: error.code,
            message: error.message,
          });
        } else {
          failed.push({
            enrollmentId,
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    return { updated, failed };
  }

  /**
   * Transfer a student between institutions.
   *
   * Requirement 6.3: Create a transfer record linking source and destination
   * institutions with transfer date and reason. Transition the student's
   * enrollment status to "transferred" at the source institution and "enrolled"
   * at the destination institution.
   *
   * Requirement 6.4: Reject transfer if destination institution does not exist
   * or is inactive.
   *
   * @throws NotFoundError if source enrollment or destination institution not found
   * @throws BusinessRuleError if destination institution is inactive or source not ENROLLED
   */
  async transferStudent(
    tenantId: string,
    input: StudentTransferInput,
  ): Promise<{
    sourceEnrollment: EnrollmentEntity;
    destinationEnrollment: EnrollmentEntity;
    transferRecord: TransferRecordEntity;
  }> {
    // Validate source enrollment exists and is ENROLLED
    const sourceEnrollment = await this.repository.findEnrollmentById(
      input.sourceEnrollmentId,
      tenantId,
    );
    if (!sourceEnrollment) {
      throw new NotFoundError(`Source enrollment with id '${input.sourceEnrollmentId}' not found`);
    }
    if (sourceEnrollment.studentId !== input.studentId) {
      throw new BusinessRuleError('Source enrollment does not belong to the specified student');
    }
    if (sourceEnrollment.status !== EnrollmentStatus.ENROLLED) {
      throw new BusinessRuleError(
        `Cannot transfer: source enrollment status is '${sourceEnrollment.status}', must be 'ENROLLED'`,
      );
    }

    // Requirement 6.4: Validate destination institution exists and is active
    const destinationInstitution = await this.repository.findInstitutionById(
      input.destinationInstitutionId,
      tenantId,
    );
    if (!destinationInstitution) {
      throw new BusinessRuleError(
        `Transfer rejected: destination institution with id '${input.destinationInstitutionId}' does not exist`,
      );
    }
    if (destinationInstitution.status !== 'active' && destinationInstitution.status !== 'ACTIVE') {
      throw new BusinessRuleError(`Transfer rejected: destination institution is inactive`);
    }

    // W2-SIS-04: destination class/section placement is required.
    if (!input.destinationClassId) {
      throw new BusinessRuleError(
        'destinationClassId is required — transfer must place the student in a class/section',
      );
    }

    // PRC-H094: pre-validate BEFORE any write. The source itself is the only
    // active enrollment allowed in the destination period (it becomes TRANSFERRED).
    const activeInDestinationPeriod = await this.repository.findActiveEnrollment(
      tenantId,
      input.studentId,
      input.academicPeriodId,
    );
    if (activeInDestinationPeriod && activeInDestinationPeriod.id !== input.sourceEnrollmentId) {
      throw new ConflictError(
        `Student already has an active enrollment for academic period '${input.academicPeriodId}'`,
      );
    }
    const transferDate = new Date(input.transferDate);
    const destinationEnrollmentId = uuidv4();
    // Source update, destination insert, transfer record (and history) commit
    // together in one transaction — never a student with no active enrollment.
    return this.repository.transferEnrollment({
      tenantId,
      sourceEnrollmentId: input.sourceEnrollmentId,
      expectedSourceStatus: EnrollmentStatus.ENROLLED,
      sourceUpdate: { status: EnrollmentStatus.TRANSFERRED, exitedAt: transferDate },
      sourceHistory: { reason: input.reason, effectiveDate: transferDate },
      destination: {
        id: destinationEnrollmentId,
        tenantId,
        studentId: input.studentId,
        institutionId: input.destinationInstitutionId,
        gradeId: input.destinationGradeId,
        classId: input.destinationClassId,
        academicPeriodId: input.academicPeriodId,
        status: EnrollmentStatus.ENROLLED,
        enrolledAt: transferDate,
        exitedAt: null,
      },
      destinationHistory: {
        reason: `Transfer from institution ${sourceEnrollment.institutionId}: ${input.reason}`,
        effectiveDate: transferDate,
      },
      transfer: {
        id: uuidv4(),
        tenantId,
        studentId: input.studentId,
        sourceInstitutionId: sourceEnrollment.institutionId,
        sourceEnrollmentId: input.sourceEnrollmentId,
        destinationInstitutionId: input.destinationInstitutionId,
        destinationEnrollmentId,
        transferDate,
        reason: input.reason,
      },
    });
  }

  /**
   * Get a single enrollment by ID.
   *
   * @throws NotFoundError if enrollment not found
   */
  async getEnrollmentById(tenantId: string, id: string): Promise<EnrollmentEntity> {
    const enrollment = await this.repository.findEnrollmentById(id, tenantId);
    if (!enrollment) {
      throw new NotFoundError(`Enrollment with id '${id}' not found`);
    }
    return enrollment;
  }

  /**
   * List enrollments with pagination and filtering.
   */
  async listEnrollments(
    tenantId: string,
    filter: EnrollmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<EnrollmentEntity>> {
    return this.repository.listEnrollments(tenantId, filter, pagination);
  }

  /**
   * Get enrollment history for a student.
   * Requirement 6.2: Complete history of status changes.
   */
  async getStudentEnrollmentHistory(
    tenantId: string,
    studentId: string,
  ): Promise<EnrollmentHistoryEntity[]> {
    return this.repository.getEnrollmentHistory(tenantId, studentId);
  }

  /**
   * Get transfer records for a student.
   */
  async getStudentTransferRecords(
    tenantId: string,
    studentId: string,
  ): Promise<TransferRecordEntity[]> {
    return this.repository.getTransferRecords(tenantId, studentId);
  }

  /**
   * Load one transfer for the caller's tenant.
   * A row that exists only in another tenant is indistinguishable from a missing id.
   */
  async getTransferById(tenantId: string, transferId: string): Promise<TransferRecordDetail> {
    const record = await this.repository.getTransferById(tenantId, transferId);
    if (!record) {
      throw new NotFoundError(`Transfer with id '${transferId}' not found`);
    }
    return record;
  }

  /** W3-RACE-02 — one ENROLLED row per student per academic period (service guard). */
  private async assertNoActiveEnrollment(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<void> {
    const existing = await this.repository.findActiveEnrollment(
      tenantId,
      studentId,
      academicPeriodId,
    );
    if (existing) {
      throw new ConflictError(
        `Student already has an active enrollment for academic period '${academicPeriodId}'`,
      );
    }
  }
}
