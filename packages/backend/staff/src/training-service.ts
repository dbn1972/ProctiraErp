/**
 * Training Service
 *
 * Business logic for training programs, sessions, attendance, and certification.
 *
 * Requirements:
 * - 7.4: Manage training programs, sessions, attendance, and certification tracking
 *         including certification expiry dates
 * - 7.8: Update certification status to expired and trigger notification on expiry
 */
import { NotFoundError, BusinessRuleError, ConflictError, ValidationError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  TrainingProgramEntity,
  TrainingSessionEntity,
  TrainingAttendanceEntity,
  CertificationEntity,
  CertificationFilter,
  TrainingProgramRepository,
  TrainingSessionRepository,
  TrainingAttendanceRepository,
  CertificationRepository,
} from './training-repository.js';
import { CertificationStatus, isCalendarDate } from './training-schemas.js';
import type {
  CreateTrainingProgramInput,
  UpdateTrainingProgramInput,
  CreateTrainingSessionInput,
  RecordTrainingAttendanceInput,
  IssueCertificationInput,
} from './training-schemas.js';
import { assertStaffInTenant, type StaffExistsCheck } from './staff-reference.js';

/**
 * Interface for notification integration.
 * Sends notifications when certifications expire.
 */
export interface NotificationIntegration {
  sendCertificationExpiryNotification(
    tenantId: string,
    staffId: string,
    certificationName: string,
    expiryDate: string,
  ): Promise<void>;
}

/** PRC-L154: defense in depth — never let non-positive/unbounded paging reach SQL. */
export const TRAINING_MAX_PAGE_SIZE = 100;

export function clampTrainingPagination(p: PaginationOptions): PaginationOptions {
  const page = Number.isFinite(p.page) ? Math.max(1, Math.floor(p.page)) : 1;
  const size = Number.isFinite(p.pageSize) ? Math.floor(p.pageSize) : 20;
  return { ...p, page, pageSize: Math.min(TRAINING_MAX_PAGE_SIZE, Math.max(1, size)) };
}

/** PRC-L155: reject impossible calendar dates with a 400 instead of a PG cast 500. */
function assertCalendarDates(fields: Record<string, string | null | undefined>): void {
  const errors = Object.entries(fields)
    .filter(([, v]) => v != null && !isCalendarDate(v))
    .map(([field]) => ({
      field,
      message: `${field} must be a valid calendar date (YYYY-MM-DD)`,
      rule: 'format',
    }));
  if (errors.length > 0) throw new ValidationError('Validation failed', errors);
}

/**
 * PRC-L361: pure calendar-day arithmetic in UTC. `new Date('YYYY-MM-DD')` parses as UTC
 * midnight, so mixing it with local `setDate` drifts by a day across DST in non-UTC hosts.
 */
export function addUtcDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Service handling training program business logic.
 */
export class TrainingService {
  constructor(
    private readonly programRepository: TrainingProgramRepository,
    private readonly sessionRepository: TrainingSessionRepository,
    private readonly attendanceRepository: TrainingAttendanceRepository,
    private readonly certificationRepository: CertificationRepository,
    private readonly notificationIntegration?: NotificationIntegration,
    /** PRC-M374: tenant-scoped staff existence check. */
    private readonly staffExists?: StaffExistsCheck,
  ) {}

  // ─── Training Programs ───────────────────────────────────────────────

  /**
   * Create a training program.
   *
   * Validates:
   * - endDate must be after startDate
   */
  async createProgram(
    tenantId: string,
    input: CreateTrainingProgramInput,
  ): Promise<TrainingProgramEntity> {
    assertCalendarDates({ startDate: input.startDate, endDate: input.endDate });
    if (input.endDate <= input.startDate) {
      throw new BusinessRuleError(
        `Program end date (${input.endDate}) must be after start date (${input.startDate})`,
      );
    }

    const program: Omit<TrainingProgramEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      description: input.description ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      provider: input.provider ?? null,
      certificationName: input.certificationName ?? null,
      certificationValidityDays: input.certificationValidityDays ?? null,
    };

    return this.programRepository.create(program);
  }

  /**
   * Get a training program by ID.
   *
   * @throws NotFoundError if program not found
   */
  async getProgram(tenantId: string, programId: string): Promise<TrainingProgramEntity> {
    const program = await this.programRepository.findById(programId, tenantId);
    if (!program) {
      throw new NotFoundError(`Training program with id '${programId}' not found`);
    }
    return program;
  }

  /**
   * Update a training program.
   *
   * @throws NotFoundError if program not found
   * @throws BusinessRuleError if endDate <= startDate after update
   */
  async updateProgram(
    tenantId: string,
    programId: string,
    input: UpdateTrainingProgramInput,
  ): Promise<TrainingProgramEntity> {
    assertCalendarDates({ startDate: input.startDate, endDate: input.endDate });
    const existing = await this.programRepository.findById(programId, tenantId);
    if (!existing) {
      throw new NotFoundError(`Training program with id '${programId}' not found`);
    }

    const newStartDate = input.startDate ?? existing.startDate;
    const newEndDate = input.endDate ?? existing.endDate;

    if (newEndDate <= newStartDate) {
      throw new BusinessRuleError(
        `Program end date (${newEndDate}) must be after start date (${newStartDate})`,
      );
    }

    // PRC-L361: a date-range edit must not orphan existing sessions outside the program.
    if (newStartDate !== existing.startDate || newEndDate !== existing.endDate) {
      await this.assertSessionsWithin(tenantId, programId, newStartDate, newEndDate);
    }

    const updateData: Partial<TrainingProgramEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.startDate !== undefined) updateData.startDate = input.startDate;
    if (input.endDate !== undefined) updateData.endDate = input.endDate;
    if (input.provider !== undefined) updateData.provider = input.provider;
    if (input.certificationName !== undefined)
      updateData.certificationName = input.certificationName;
    if (input.certificationValidityDays !== undefined)
      updateData.certificationValidityDays = input.certificationValidityDays;

    const updated = await this.programRepository.update(programId, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Training program with id '${programId}' not found`);
    }

    return updated;
  }

  private async assertSessionsWithin(
    tenantId: string,
    programId: string,
    startDate: string,
    endDate: string,
  ): Promise<void> {
    for (let page = 1; ; page++) {
      const result = await this.sessionRepository.listByProgram(tenantId, programId, {
        page,
        pageSize: TRAINING_MAX_PAGE_SIZE,
      });
      const outside = result.data.filter((x) => x.date < startDate || x.date > endDate);
      if (outside.length > 0) {
        throw new BusinessRuleError(
          `Program date range (${startDate} to ${endDate}) would exclude ${outside.length} existing session(s); reschedule them first`,
        );
      }
      if (page >= result.meta.totalPages || result.data.length === 0) return;
    }
  }

  /**
   * List training programs with optional search.
   */
  async listPrograms(
    tenantId: string,
    search: string | undefined,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TrainingProgramEntity>> {
    return this.programRepository.list(tenantId, search, clampTrainingPagination(pagination));
  }

  // ─── Training Sessions ───────────────────────────────────────────────

  /**
   * Create a training session within a program.
   *
   * Validates:
   * - Program exists
   * - Session date is within program date range
   *
   * @throws NotFoundError if program not found
   * @throws BusinessRuleError if session date is outside program range
   */
  async createSession(
    tenantId: string,
    input: CreateTrainingSessionInput,
  ): Promise<TrainingSessionEntity> {
    assertCalendarDates({ date: input.date });
    if (input.startTime && input.endTime && input.endTime <= input.startTime) {
      throw new ValidationError('Validation failed', [
        { field: 'endTime', message: 'endTime must be after startTime', rule: 'invalid' },
      ]);
    }
    const program = await this.programRepository.findById(input.programId, tenantId);
    if (!program) {
      throw new NotFoundError(`Training program with id '${input.programId}' not found`);
    }

    if (input.date < program.startDate || input.date > program.endDate) {
      throw new BusinessRuleError(
        `Session date (${input.date}) must be within program date range (${program.startDate} to ${program.endDate})`,
      );
    }

    const session: Omit<TrainingSessionEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      programId: input.programId,
      title: input.title,
      date: input.date,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      location: input.location ?? null,
      instructorName: input.instructorName ?? null,
    };

    return this.sessionRepository.create(session);
  }

  /**
   * Get a training session by ID.
   *
   * @throws NotFoundError if session not found
   */
  async getSession(tenantId: string, sessionId: string): Promise<TrainingSessionEntity> {
    const session = await this.sessionRepository.findById(sessionId, tenantId);
    if (!session) {
      throw new NotFoundError(`Training session with id '${sessionId}' not found`);
    }
    return session;
  }

  /**
   * List sessions for a program.
   */
  async listSessions(
    tenantId: string,
    programId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TrainingSessionEntity>> {
    return this.sessionRepository.listByProgram(
      tenantId,
      programId,
      clampTrainingPagination(pagination),
    );
  }

  // ─── Training Attendance ─────────────────────────────────────────────

  /**
   * Record attendance for a staff member at a training session.
   *
   * Validates:
   * - Session exists
   * - No duplicate attendance record for same session+staff
   *
   * @throws NotFoundError if session not found
   * @throws ConflictError if attendance already recorded
   */
  async recordAttendance(
    tenantId: string,
    input: RecordTrainingAttendanceInput,
  ): Promise<TrainingAttendanceEntity> {
    await assertStaffInTenant(this.staffExists, tenantId, input.staffId);
    const session = await this.sessionRepository.findById(input.sessionId, tenantId);
    if (!session) {
      throw new NotFoundError(`Training session with id '${input.sessionId}' not found`);
    }

    // Check for duplicate
    const existing = await this.attendanceRepository.findBySessionAndStaff(
      input.sessionId,
      input.staffId,
      tenantId,
    );
    if (existing) {
      throw new ConflictError(
        `Attendance already recorded for staff '${input.staffId}' at session '${input.sessionId}'`,
      );
    }

    const attendance: Omit<TrainingAttendanceEntity, 'createdAt'> = {
      id: uuidv4(),
      tenantId,
      sessionId: input.sessionId,
      staffId: input.staffId,
      status: input.status,
      comment: input.comment ?? null,
    };

    return this.attendanceRepository.create(attendance);
  }

  /**
   * Get attendance records for a session.
   */
  async getSessionAttendance(
    tenantId: string,
    sessionId: string,
  ): Promise<TrainingAttendanceEntity[]> {
    return this.attendanceRepository.listBySession(tenantId, sessionId);
  }

  /**
   * Get attendance records for a staff member.
   */
  async getStaffAttendance(tenantId: string, staffId: string): Promise<TrainingAttendanceEntity[]> {
    return this.attendanceRepository.listByStaff(tenantId, staffId);
  }

  // ─── Certifications ──────────────────────────────────────────────────

  /**
   * Issue a certification to a staff member.
   *
   * Validates:
   * - Program exists
   * - If expiryDate is provided, it must be after issuedDate
   *
   * @throws NotFoundError if program not found
   * @throws BusinessRuleError if expiryDate <= issuedDate
   */
  async issueCertification(
    tenantId: string,
    input: IssueCertificationInput,
  ): Promise<CertificationEntity> {
    await assertStaffInTenant(this.staffExists, tenantId, input.staffId);
    assertCalendarDates({ issuedDate: input.issuedDate, expiryDate: input.expiryDate });
    const program = await this.programRepository.findById(input.programId, tenantId);
    if (!program) {
      throw new NotFoundError(`Training program with id '${input.programId}' not found`);
    }

    // Determine expiry date
    let expiryDate = input.expiryDate ?? null;
    if (!expiryDate && program.certificationValidityDays) {
      // Calculate expiry from issued date + validity days
      expiryDate = addUtcDays(input.issuedDate, program.certificationValidityDays);
    }

    if (expiryDate && expiryDate <= input.issuedDate) {
      throw new BusinessRuleError(
        `Certification expiry date (${expiryDate}) must be after issued date (${input.issuedDate})`,
      );
    }

    // PRC-L361 explicit re-issue rule: one ACTIVE certification per staff+program. Re-issue
    // requires the previous one to be expired/revoked first. (A partial unique index in the DB
    // is a tracked follow-up migration; this is the application-level guard.)
    const active = await this.certificationRepository.list(
      tenantId,
      { staffId: input.staffId, programId: input.programId, status: CertificationStatus.ACTIVE },
      { page: 1, pageSize: 1 },
    );
    if (active.meta.totalItems > 0) {
      throw new ConflictError(
        `Staff '${input.staffId}' already holds an active certification for program '${input.programId}'`,
      );
    }

    const certification: Omit<CertificationEntity, 'createdAt' | 'updatedAt'> = {
      id: uuidv4(),
      tenantId,
      staffId: input.staffId,
      programId: input.programId,
      certificationName: input.certificationName,
      issuedDate: input.issuedDate,
      expiryDate,
      status: CertificationStatus.ACTIVE,
    };

    return this.certificationRepository.create(certification);
  }

  /**
   * Get a certification by ID.
   *
   * @throws NotFoundError if certification not found
   */
  async getCertification(tenantId: string, certificationId: string): Promise<CertificationEntity> {
    const cert = await this.certificationRepository.findById(certificationId, tenantId);
    if (!cert) {
      throw new NotFoundError(`Certification with id '${certificationId}' not found`);
    }
    return cert;
  }

  /**
   * List certifications with filtering.
   */
  async listCertifications(
    tenantId: string,
    filter: CertificationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<CertificationEntity>> {
    return this.certificationRepository.list(tenantId, filter, clampTrainingPagination(pagination));
  }

  /**
   * Check for expired certifications and update their status.
   * Triggers notifications to staff members and their supervisors.
   *
   * This method should be called periodically (e.g., daily via a scheduled job).
   *
   * Requirement 7.8: IF a certification expiry date is reached, THEN update status
   * to expired and trigger a notification to the staff member and their supervisor.
   *
   * @returns Array of certifications that were marked as expired
   */
  async processExpiredCertifications(
    tenantId: string,
    asOfDate?: string,
  ): Promise<CertificationEntity[]> {
    assertCalendarDates({ asOfDate });
    const checkDate = asOfDate ?? new Date().toISOString().split('T')[0]!;

    const expiredCerts = await this.certificationRepository.findExpiredCertifications(
      tenantId,
      checkDate,
    );

    const updatedCerts: CertificationEntity[] = [];

    for (const cert of expiredCerts) {
      // Update status to EXPIRED
      const updated = await this.certificationRepository.update(cert.id, tenantId, {
        status: CertificationStatus.EXPIRED,
      });

      if (updated) {
        updatedCerts.push(updated);

        // Trigger notification
        if (this.notificationIntegration) {
          await this.notificationIntegration.sendCertificationExpiryNotification(
            tenantId,
            cert.staffId,
            cert.certificationName,
            cert.expiryDate!,
          );
        }
      }
    }

    return updatedCerts;
  }
}
