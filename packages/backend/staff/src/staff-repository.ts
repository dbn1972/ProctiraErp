/**
 * Staff Repository Interface
 *
 * Defines the data access contract for staff operations.
 * Implementations can use Prisma, in-memory stores, or other backends.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type { StaffOffboardMeta } from './offboard-meta.js';
import type { StaffTypeFilter } from './staff-type.js';

/**
 * Staff entity as stored in the database.
 */
export interface StaffEntity {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO date string (YYYY-MM-DD)
  identityNumber: string;
  contactPhone: string;
  contactEmail: string | null;
  position: string;
  status: 'ACTIVE' | 'INACTIVE';
  customData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter options for listing staff.
 */
/** PRC-M381: first-class offboard columns (db/sql/260); null fields = unknown in backfill. */
export interface StaffOffboardRecord {
  effectiveDate: string | null;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface StaffFilter {
  status?: 'ACTIVE' | 'INACTIVE';
  position?: string;
  search?: string; // Full-text search on name and identity number
  /** When set, only staff with an assignment at this institution are returned. */
  institutionId?: string;
  /** PRC-M120: teaching vs non-teaching, derived from position. */
  staffType?: StaffTypeFilter;
  /** PRC-M120: restrict to these staff ids (e.g. on approved leave today). */
  ids?: ReadonlySet<string>;
}

/**
 * PRC-L153/L246: write scope bound to ONE database transaction. `executor` runs raw SQL on
 * the same connection/transaction (pg-style `query(text, values)`), so dependent rows in
 * other stores (e.g. staff_contracts) commit or roll back with the staff row.
 */
export interface StaffTransactionScope {
  create(data: Omit<StaffEntity, 'createdAt' | 'updatedAt'>): Promise<StaffEntity>;
  executor: {
    query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  };
}

/**
 * PRC-M013 (Topic 5, Option A — staff): same-transaction audit for staff PII
 * mutations. The audit row must commit atomically with the staff change so a
 * forced audit failure rolls the mutation back and no unaudited durable staff
 * mutation can exist. This package takes NO dependency on
 * `@proctira/backend-audit`; the port is the inversion boundary (the gateway
 * supplies the real `appendAuditEntryOnClient`). Mirrors the PRC-L264
 * tenant-admin `RolesTxnAuditPort`.
 */
export interface StaffTxnAuditEvent {
  tenantId: string;
  entityType: 'staff';
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
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
export interface StaffTxnAuditClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface StaffTxnAuditPort {
  /** Append the audit row on the caller's transaction client. */
  appendAuditInTxn(client: StaffTxnAuditClient, event: StaffTxnAuditEvent): Promise<void>;
}

/**
 * PRC-M013: audit context a mutating repository call carries so the audit row
 * is written in the same transaction. Supplied by {@link StaffService} only
 * when the repository advertises {@link StaffRepository.supportsTransactionalAudit}.
 */
export interface StaffAuditDirective {
  operation: 'UPDATE' | 'DELETE';
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  actorId: string | null;
  ipAddress: string | null;
  requestId: string | null;
}

/**
 * Repository interface for staff data access.
 */
export interface StaffRepository {
  /**
   * PRC-M013: when `true`, the repository writes the staff mutation audit row in
   * the SAME transaction as the mutation (given a {@link StaffAuditDirective}),
   * so the service must NOT also emit a post-hoc audit event for that mutation.
   * Absent / `false` (e.g. the in-memory repository) keeps the post-hoc path.
   */
  readonly supportsTransactionalAudit?: boolean;

  /** Create a new staff record */
  create(data: Omit<StaffEntity, 'createdAt' | 'updatedAt'>): Promise<StaffEntity>;

  /** Update an existing staff record */
  update(
    id: string,
    tenantId: string,
    data: Partial<StaffEntity>,
    audit?: StaffAuditDirective,
  ): Promise<StaffEntity | null>;

  /** Find a staff record by ID within a tenant */
  findById(id: string, tenantId: string): Promise<StaffEntity | null>;

  /** Find a staff record by identity number (globally unique across all staff) */
  findByIdentityNumber(identityNumber: string): Promise<StaffEntity | null>;

  /** List staff with pagination and filtering */
  list(
    tenantId: string,
    filter: StaffFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<StaffEntity>>;

  /** Delete a staff record */
  delete(id: string, tenantId: string, audit?: StaffAuditDirective): Promise<boolean>;

  /**
   * PRC-L157: count dependent HR records (payroll lines, contracts, attendance, leave,
   * appraisals, training) keyed by kind. Staff with dependents must be offboarded, not deleted.
   */
  countDependents?(id: string, tenantId: string): Promise<Record<string, number>>;

  /** PRC-L153: ids (of `ids`) that exist and are not deleted for the tenant — one query. */
  findExistingIds?(ids: readonly string[], tenantId: string): Promise<string[]>;

  /**
   * PRC-H090: institution ids a staff member is assigned to (via staff_assignments).
   * Used to enforce school-scope on writes. Empty array when unassigned/unknown.
   */
  findInstitutionIds?(tenantId: string, staffId: string): Promise<string[]>;

  /**
   * PRC-L153: hard-remove a row this request just created (compensating rollback when a
   * dependent write in another store fails). Never use for user-initiated deletes.
   */
  purgeCreated?(id: string, tenantId: string): Promise<void>;
  /**
   * PRC-H089: keyset page of non-deleted staff ordered by id ascending, strictly after
   * `afterId` (null = from the start). Used to iterate an entire tenant (payroll).
   */
  listAfterId?(tenantId: string, afterId: string | null, limit: number): Promise<StaffEntity[]>;
  /**
   * PRC-L153/L246: run `fn` inside one tenant-bound transaction. Any throw rolls back every
   * write made through the scope (staff rows and `executor` SQL).
   */
  withTransaction?<T>(
    tenantId: string,
    fn: (scope: StaffTransactionScope) => Promise<T>,
  ): Promise<T>;
  /**
   * PRC-M381: record the offboard decision in ONE conditional write — status
   * INACTIVE, the first-class offboard columns, and the legacy
   * customData.__offboard copy — only when the row is not already offboarded.
   * Returns null (nothing written) when the staff row is missing or a
   * concurrent offboard already won.
   */
  markOffboarded(
    id: string,
    tenantId: string,
    meta: StaffOffboardMeta,
    audit?: StaffAuditDirective,
  ): Promise<StaffEntity | null>;
  /** PRC-M381: the persisted offboard columns, or null when not offboarded. */
  findOffboardRecord(id: string, tenantId: string): Promise<StaffOffboardRecord | null>;
}
