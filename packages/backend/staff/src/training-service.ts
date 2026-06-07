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
import {
  NotFoundError,
  BusinessRuleError,
  ConflictError,
} from '@proctira/common';
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
import { CertificationStatus } from './training-schemas.js';
import type {
  CreateTrainingProgramInput,
  UpdateTrainingProgramInput,
  CreateTrainingSessionInput,
  RecordTrainingAttendanceInput,
  IssueCertificationInput,
} from './training-schemas.js';

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

    const updateData: Partial<TrainingProgramEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.startDate !== undefined) updateData.startDate = input.startDate;
    if (input.endDate !== undefined) updateData.endDate = input.endDate;
    if (input.provider !== undefined) updateData.provider = input.provider;
    if (input.certificationName !== undefined) updateData.certificationName = input.certificationName;
    if (input.certificationValidityDays !== undefined) updateData.certificationValidityDays = input.certificationValidityDays;

    const updated = await this.programRepository.update(programId, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Training program with id '${programId}' not found`);
    }

    return updated;
  }

  /**
   * List training programs with optional search.
   */
  async listPrograms(
    tenantId: string,
    search: string | undefined,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<TrainingProgramEntity>> {
    return this.programRepository.list(tenantId, search, pagination);
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
    return this.sessionRepository.listByProgram(tenantId, programId, pagination);
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
      status: input.status as 'PRESENT' | 'ABSENT' | 'EXCUSED',
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
  async getStaffAttendance(
    tenantId: string,
    staffId: string,
  ): Promise<TrainingAttendanceEntity[]> {
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
    const program = await this.programRepository.findById(input.programId, tenantId);
    if (!program) {
      throw new NotFoundError(`Training program with id '${input.programId}' not found`);
    }

    // Determine expiry date
    let expiryDate = input.expiryDate ?? null;
    if (!expiryDate && program.certificationValidityDays) {
      // Calculate expiry from issued date + validity days
      const issued = new Date(input.issuedDate);
      issued.setDate(issued.getDate() + program.certificationValidityDays);
      expiryDate = issued.toISOString().split('T')[0]!;
    }

    if (expiryDate && expiryDate <= input.issuedDate) {
      throw new BusinessRuleError(
        `Certification expiry date (${expiryDate}) must be after issued date (${input.issuedDate})`,
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
    return this.certificationRepository.list(tenantId, filter, pagination);
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
