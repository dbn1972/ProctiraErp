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
  NotFoundError,
  BusinessRuleError,
  EnrollmentStatus,
} from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  EnrollmentEntity,
  EnrollmentFilter,
  EnrollmentHistoryEntity,
  EnrollmentRepository,
  TransferRecordEntity,
} from './enrollment-repository.js';
import type {
  CreateEnrollmentInput,
  UpdateEnrollmentStatusInput,
  StudentTransferInput,
} from './schemas.js';

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
    input: CreateEnrollmentInput,
  ): Promise<EnrollmentEntity> {
    // Validate institution exists and is active
    const institution = await this.repository.findInstitutionById(
      input.institutionId,
      tenantId,
    );
    if (!institution) {
      throw new NotFoundError(
        `Institution with id '${input.institutionId}' not found`,
      );
    }
    if (institution.status !== 'active' && institution.status !== 'ACTIVE') {
      throw new BusinessRuleError(
        'Cannot enroll student at an inactive institution',
      );
    }

    const enrollmentId = uuidv4();
    const enrollment = await this.repository.createEnrollment({
      id: enrollmentId,
      tenantId,
      studentId: input.studentId,
      institutionId: input.institutionId,
      gradeId: input.gradeId,
      classId: input.classId ?? null,
      academicPeriodId: input.academicPeriodId,
      status: EnrollmentStatus.ENROLLED,
      enrolledAt: new Date(input.enrolledAt),
      exitedAt: null,
    });

    // Record initial history entry
    await this.repository.createHistoryEntry({
      id: uuidv4(),
      tenantId,
      enrollmentId: enrollment.id,
      previousStatus: null,
      newStatus: EnrollmentStatus.ENROLLED,
      effectiveDate: new Date(input.enrolledAt),
      institutionId: input.institutionId,
      academicPeriodId: input.academicPeriodId,
      reason: 'Initial enrollment',
    });

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
    const newStatus = input.status as 'WITHDRAWN' | 'GRADUATED';

    const updated = await this.repository.updateEnrollment(enrollmentId, tenantId, {
      status: newStatus,
      exitedAt: new Date(input.effectiveDate),
    });

    if (!updated) {
      throw new NotFoundError(`Enrollment with id '${enrollmentId}' not found`);
    }

    // Record history entry
    await this.repository.createHistoryEntry({
      id: uuidv4(),
      tenantId,
      enrollmentId,
      previousStatus,
      newStatus,
      effectiveDate: new Date(input.effectiveDate),
      institutionId: enrollment.institutionId,
      academicPeriodId: enrollment.academicPeriodId,
      reason: input.reason,
    });

    return updated;
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
      throw new NotFoundError(
        `Source enrollment with id '${input.sourceEnrollmentId}' not found`,
      );
    }
    if (sourceEnrollment.studentId !== input.studentId) {
      throw new BusinessRuleError(
        'Source enrollment does not belong to the specified student',
      );
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
      throw new BusinessRuleError(
        `Transfer rejected: destination institution is inactive`,
      );
    }

    // Step 1: Set source enrollment to TRANSFERRED
    const updatedSource = await this.repository.updateEnrollment(
      input.sourceEnrollmentId,
      tenantId,
      {
        status: EnrollmentStatus.TRANSFERRED,
        exitedAt: new Date(input.transferDate),
      },
    );
    if (!updatedSource) {
      throw new NotFoundError(
        `Source enrollment with id '${input.sourceEnrollmentId}' not found`,
      );
    }

    // Record history entry for source (transferred out)
    await this.repository.createHistoryEntry({
      id: uuidv4(),
      tenantId,
      enrollmentId: input.sourceEnrollmentId,
      previousStatus: EnrollmentStatus.ENROLLED,
      newStatus: EnrollmentStatus.TRANSFERRED,
      effectiveDate: new Date(input.transferDate),
      institutionId: sourceEnrollment.institutionId,
      academicPeriodId: sourceEnrollment.academicPeriodId,
      reason: input.reason,
    });

    // Step 2: Create new enrollment at destination with status ENROLLED
    const destinationEnrollmentId = uuidv4();
    const destinationEnrollment = await this.repository.createEnrollment({
      id: destinationEnrollmentId,
      tenantId,
      studentId: input.studentId,
      institutionId: input.destinationInstitutionId,
      gradeId: input.destinationGradeId,
      classId: input.destinationClassId ?? null,
      academicPeriodId: input.academicPeriodId,
      status: EnrollmentStatus.ENROLLED,
      enrolledAt: new Date(input.transferDate),
      exitedAt: null,
    });

    // Record history entry for destination (enrolled via transfer)
    await this.repository.createHistoryEntry({
      id: uuidv4(),
      tenantId,
      enrollmentId: destinationEnrollmentId,
      previousStatus: null,
      newStatus: EnrollmentStatus.ENROLLED,
      effectiveDate: new Date(input.transferDate),
      institutionId: input.destinationInstitutionId,
      academicPeriodId: input.academicPeriodId,
      reason: `Transfer from institution ${sourceEnrollment.institutionId}: ${input.reason}`,
    });

    // Step 3: Create transfer record
    const transferRecord = await this.repository.createTransferRecord({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      sourceInstitutionId: sourceEnrollment.institutionId,
      sourceEnrollmentId: input.sourceEnrollmentId,
      destinationInstitutionId: input.destinationInstitutionId,
      destinationEnrollmentId: destinationEnrollmentId,
      transferDate: new Date(input.transferDate),
      reason: input.reason,
    });

    return {
      sourceEnrollment: updatedSource,
      destinationEnrollment,
      transferRecord,
    };
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
}
