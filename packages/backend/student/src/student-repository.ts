/**
 * Student Repository Interface
 *
 * Defines the data access contract for student operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { ConflictError } from '@proctira/common';

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
  /** When set, only students enrolled at this institution are returned. */
  institutionId?: string;
  /** When set, only these student ids are returned (batch label lookup). */
  ids?: string[];
}

/** PRC-L365: optimistic-concurrency precondition for student updates. */
export interface StudentUpdateOptions {
  /** The `updatedAt` the caller last read; a mismatch rejects the write (409). */
  expectedUpdatedAt?: Date;
}

/**
 * PRC-L365: thrown when an If-Match / expectedUpdatedAt precondition is stale.
 * Maps to HTTP 409 via the shared ConflictError.
 */
export class StaleStudentUpdateError extends ConflictError {
  constructor(id: string) {
    super(`Student '${id}' was modified by another request; reload and retry`);
  }
}

/** True when `stored` matches the caller's precondition at millisecond precision. */
export function updatedAtMatches(stored: Date, expected: Date): boolean {
  return stored.getTime() === expected.getTime();
}

/**
 * PRC-M013: durable audit event a student PII mutation writes inside its own
 * transaction. `entityType` is always `student`; the entity id is the student id.
 */
export interface StudentTxnAuditEvent {
  tenantId: string;
  entityType: 'student';
  entityId: string;
  operation: 'UPDATE' | 'DELETE';
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  /** JWT `sub` of the caller; null when raised outside an authenticated request. */
  actorId: string | null;
  /** Client IP resolved by the gateway; null outside a request. */
  ipAddress: string | null;
  requestId: string | null;
}

/**
 * The injected client type is intentionally structural (`query(text, values)`)
 * so this package does not import a database client type. The gateway passes a
 * `PgQueryable`-shaped adapter built over the mutation's own transaction.
 */
export interface StudentTxnAuditClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface StudentTxnAuditPort {
  /** Append the audit row on the caller's transaction client. */
  appendAuditInTxn(client: StudentTxnAuditClient, event: StudentTxnAuditEvent): Promise<void>;
}

/**
 * PRC-M013: audit context a mutating repository call carries so the audit row
 * is written in the same transaction. Supplied by {@link StudentService} only
 * when the repository advertises {@link StudentRepository.supportsTransactionalAudit}.
 */
export interface StudentAuditDirective {
  operation: 'UPDATE' | 'DELETE';
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  actorId: string | null;
  ipAddress: string | null;
  requestId: string | null;
}

/**
 * Repository interface for student data access.
 */
export interface StudentRepository {
  /**
   * PRC-M013: when `true`, the repository writes the student PII mutation audit
   * row in the SAME transaction as the mutation (given a
   * {@link StudentAuditDirective}), so the service must NOT also emit a post-hoc
   * audit event for that mutation. Absent / `false` (e.g. the in-memory
   * repository) keeps the post-hoc path.
   */
  readonly supportsTransactionalAudit?: boolean;

  /** Create a new student */
  create(data: Omit<StudentEntity, 'createdAt' | 'updatedAt'>): Promise<StudentEntity>;

  /**
   * Update an existing student.
   * PRC-L365: when `options.expectedUpdatedAt` is set the write is conditional —
   * implementations must re-check the stored `updatedAt` atomically with the
   * write and throw `StaleStudentUpdateError` when it differs.
   * PRC-M013: when `audit` is supplied and the implementation supports
   * transactional audit, the audit row is written in the same transaction.
   */
  update(
    id: string,
    tenantId: string,
    data: Partial<StudentEntity>,
    options?: StudentUpdateOptions,
    audit?: StudentAuditDirective,
  ): Promise<StudentEntity | null>;

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

  /**
   * Delete a student (soft delete).
   * PRC-M013: when `audit` is supplied and the implementation supports
   * transactional audit, the audit row is written in the same transaction.
   */
  delete(id: string, tenantId: string, audit?: StudentAuditDirective): Promise<boolean>;

  /**
   * W2-SIS-01: allocate the next unique admission number for a tenant.
   * Format: ADM-{YYYY}-{seq} (seq is monotonic per tenant).
   */
  allocateAdmissionNumber(tenantId: string): Promise<string>;

  /**
   * PRC-M384: apply all creates + updates in ONE database transaction
   * (all-or-nothing). Missing update targets abort the whole batch.
   * Optional — callers must fall back (and not claim transactional semantics)
   * when an implementation does not provide it.
   */
  bulkWrite?(tenantId: string, ops: StudentBulkWrite): Promise<StudentBulkWriteResult>;
}

export interface StudentBulkWrite {
  creates: Array<Omit<StudentEntity, 'createdAt' | 'updatedAt'>>;
  updates: Array<{ id: string; data: Partial<StudentEntity> }>;
}

export interface StudentBulkWriteResult {
  created: StudentEntity[];
  updated: StudentEntity[];
}
