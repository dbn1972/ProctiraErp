/**
 * Student Repository Interface
 *
 * Defines the data access contract for student operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

/**
 * Contact information for a student.
 */
export interface StudentContact {
  type: string;
  value: string;
  isPrimary: boolean;
}

/**
 * Guardian information for a student.
 */
export interface StudentGuardian {
  id: string;
  firstName: string;
  lastName: string;
  relationship: string;
  contactPhone?: string;
  contactEmail?: string;
}

/**
 * Identity document for a student.
 */
export interface IdentityDocument {
  type: string;
  number: string;
  issuingCountry?: string;
  expiryDate?: string;
}

/**
 * Student entity as stored in the database.
 */
export interface StudentEntity {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO date string (YYYY-MM-DD)
  gender: string;
  nationalId: string | null;
  nationality: string | null;
  contacts: StudentContact[];
  guardians: StudentGuardian[];
  identityDocuments: IdentityDocument[];
  customData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter options for listing students.
 */
export interface StudentFilter {
  gender?: string;
  search?: string;
}

/**
 * Repository interface for student data access.
 */
export interface StudentRepository {
  /** Create a new student */
  create(data: Omit<StudentEntity, 'createdAt' | 'updatedAt'>): Promise<StudentEntity>;

  /** Update an existing student */
  update(id: string, tenantId: string, data: Partial<StudentEntity>): Promise<StudentEntity | null>;

  /** Find a student by ID within a tenant */
  findById(id: string, tenantId: string): Promise<StudentEntity | null>;

  /** Find a student by national ID within a tenant */
  findByNationalId(nationalId: string, tenantId: string): Promise<StudentEntity | null>;

  /** List students with pagination and filtering */
  list(
    tenantId: string,
    filter: StudentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentEntity>>;

  /** Full-text search on student name and national ID */
  search(
    tenantId: string,
    query: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StudentEntity>>;

  /** Delete a student (soft delete) */
  delete(id: string, tenantId: string): Promise<boolean>;
}
