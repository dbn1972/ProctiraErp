/**
 * Training Repository Interface
 *
 * Defines the data access contract for training program, session, attendance,
 * and certification operations.
 *
 * Requirements:
 * - 7.4: Manage training programs, sessions, attendance, and certification tracking
 * - 7.8: Certification expiry tracking and notification triggering
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

/**
 * Training program entity.
 */
export interface TrainingProgramEntity {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  provider: string | null;
  certificationName: string | null;
  certificationValidityDays: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Training session entity.
 */
export interface TrainingSessionEntity {
  id: string;
  tenantId: string;
  programId: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  instructorName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Training attendance entity.
 */
export interface TrainingAttendanceEntity {
  id: string;
  tenantId: string;
  sessionId: string;
  staffId: string;
  status: 'PRESENT' | 'ABSENT' | 'EXCUSED';
  comment: string | null;
  createdAt: Date;
}

/**
 * Certification entity.
 */
export interface CertificationEntity {
  id: string;
  tenantId: string;
  staffId: string;
  programId: string;
  certificationName: string;
  issuedDate: string;
  expiryDate: string | null;
  status: 'ACTIVE' | 'EXPIRED' | 'REVOKED';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter options for listing certifications.
 */
export interface CertificationFilter {
  staffId?: string;
  status?: string;
  programId?: string;
}

/**
 * Repository interface for training program data access.
 */
export interface TrainingProgramRepository {
  create(data: Omit<TrainingProgramEntity, 'createdAt' | 'updatedAt'>): Promise<TrainingProgramEntity>;
  findById(id: string, tenantId: string): Promise<TrainingProgramEntity | null>;
  update(id: string, tenantId: string, data: Partial<TrainingProgramEntity>): Promise<TrainingProgramEntity | null>;
  list(tenantId: string, search: string | undefined, pagination: PaginationOptions): Promise<PaginatedResult<TrainingProgramEntity>>;
}

/**
 * Repository interface for training session data access.
 */
export interface TrainingSessionRepository {
  create(data: Omit<TrainingSessionEntity, 'createdAt' | 'updatedAt'>): Promise<TrainingSessionEntity>;
  findById(id: string, tenantId: string): Promise<TrainingSessionEntity | null>;
  listByProgram(tenantId: string, programId: string, pagination: PaginationOptions): Promise<PaginatedResult<TrainingSessionEntity>>;
}

/**
 * Repository interface for training attendance data access.
 */
export interface TrainingAttendanceRepository {
  create(data: Omit<TrainingAttendanceEntity, 'createdAt'>): Promise<TrainingAttendanceEntity>;
  findBySessionAndStaff(sessionId: string, staffId: string, tenantId: string): Promise<TrainingAttendanceEntity | null>;
  listBySession(tenantId: string, sessionId: string): Promise<TrainingAttendanceEntity[]>;
  listByStaff(tenantId: string, staffId: string): Promise<TrainingAttendanceEntity[]>;
}

/**
 * Repository interface for certification data access.
 */
export interface CertificationRepository {
  create(data: Omit<CertificationEntity, 'createdAt' | 'updatedAt'>): Promise<CertificationEntity>;
  findById(id: string, tenantId: string): Promise<CertificationEntity | null>;
  update(id: string, tenantId: string, data: Partial<CertificationEntity>): Promise<CertificationEntity | null>;
  list(tenantId: string, filter: CertificationFilter, pagination: PaginationOptions): Promise<PaginatedResult<CertificationEntity>>;
  findExpiredCertifications(tenantId: string, asOfDate: string): Promise<CertificationEntity[]>;
}
