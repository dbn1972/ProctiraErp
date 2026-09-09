/**
 * Audit Repository Interface
 *
 * Defines the contract for audit log persistence.
 * The implementation should use append-only PostgreSQL tables
 * partitioned by month for efficient querying and retention management.
 *
 * Requirements:
 * - 21.1: Record audit log entry for every create/update/delete on protected entities
 * - 21.2: Log authenticated user, timestamp, IP address, affected entity
 * - 21.3: Append-only storage preventing modification/deletion by application users
 * - 21.4: Query with filtering by entity type, user, date range, operation type
 * - 21.5: Configurable retention with automated archival
 */

import type { ChainVerification } from './audit-hash.js';

export type { ChainBreak, ChainVerification } from './audit-hash.js';

/**
 * Supported audit operations.
 */
export type AuditOperation = 'CREATE' | 'UPDATE' | 'DELETE';

/**
 * An audit log entry representing a single entity change.
 */
export interface AuditLogEntry {
  /** Unique identifier for the audit entry */
  id: string;
  /** Tenant context for multi-tenancy isolation */
  tenantId: string;
  /** The type of entity that was changed (e.g., 'student', 'institution', 'staff') */
  entityType: string;
  /** The unique identifier of the affected entity */
  entityId: string;
  /** The operation performed */
  operation: AuditOperation;
  /** The authenticated user who performed the operation */
  userId: string;
  /** The username/display name of the user (denormalized for query convenience) */
  userName: string;
  /** IP address of the client that initiated the request */
  ipAddress: string;
  /** Timestamp when the operation occurred */
  timestamp: Date;
  /** Entity state before the operation (null for CREATE) */
  beforeValues: Record<string, unknown> | null;
  /** Entity state after the operation (null for DELETE) */
  afterValues: Record<string, unknown> | null;
  /** Optional metadata (e.g., request ID, correlation ID) */
  metadata: Record<string, unknown> | null;
  /**
   * G-913 tamper-evident chain. `null` on rows written before the chain
   * existed (legacy); every new row carries all three.
   */
  chainSeq: number | null;
  prevHash: string | null;
  entryHash: string | null;
}

/**
 * Input for creating a new audit log entry.
 */
export interface CreateAuditLogInput {
  id: string;
  tenantId: string;
  entityType: string;
  entityId: string;
  operation: AuditOperation;
  userId: string;
  userName: string;
  ipAddress: string;
  timestamp: Date;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Query filters for retrieving audit log entries.
 */
export interface AuditLogQuery {
  /** Filter by tenant */
  tenantId: string;
  /** Filter by entity type */
  entityType?: string;
  /** Filter by specific entity ID */
  entityId?: string;
  /** Filter by user who performed the operation */
  userId?: string;
  /** Filter by operation type */
  operation?: AuditOperation;
  /** Filter entries from this date (inclusive) */
  startDate?: string;
  /** Filter entries up to this date (inclusive) */
  endDate?: string;
  /** Pagination: page number (1-based) */
  page: number;
  /** Pagination: items per page */
  pageSize: number;
  /** Sort order for timestamp */
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated result of audit log entries.
 */
export interface AuditLogQueryResult {
  data: AuditLogEntry[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/**
 * Retention configuration for audit logs.
 */
export interface AuditRetentionConfig {
  /** Tenant this configuration applies to */
  tenantId: string;
  /** Number of months to retain audit logs before archival */
  retentionMonths: number;
  /** Whether archival is enabled */
  archivalEnabled: boolean;
  /** Storage location for archived entries (e.g., S3 bucket path) */
  archivalDestination: string | null;
  /** Last time archival was executed */
  lastArchivalAt: Date | null;
}

/**
 * Result of an archival operation.
 */
export interface ArchivalResult {
  /** Number of entries archived */
  archivedCount: number;
  /** The cutoff date used for archival */
  cutoffDate: Date;
  /** Destination where entries were archived */
  destination: string;
  /** Timestamp of the archival operation */
  executedAt: Date;
}

/**
 * Repository interface for audit log persistence.
 *
 * Implementations must ensure:
 * - Append-only behavior (no update/delete of existing entries)
 * - Table partitioning by month for efficient queries
 * - Proper indexing for filter queries
 */
export interface AuditRepository {
  /**
   * Create a new audit log entry.
   * This is an append-only operation — entries cannot be modified after creation.
   */
  create(input: CreateAuditLogInput): Promise<AuditLogEntry>;

  /**
   * Create multiple audit log entries in a batch.
   */
  createBatch(inputs: CreateAuditLogInput[]): Promise<AuditLogEntry[]>;

  /**
   * Query audit log entries with filtering and pagination.
   */
  query(query: AuditLogQuery): Promise<AuditLogQueryResult>;

  /**
   * Get a single audit log entry by ID.
   */
  findById(tenantId: string, id: string): Promise<AuditLogEntry | null>;

  /**
   * Get the retention configuration for a tenant.
   */
  getRetentionConfig(tenantId: string): Promise<AuditRetentionConfig | null>;

  /**
   * Set or update the retention configuration for a tenant.
   */
  setRetentionConfig(config: AuditRetentionConfig): Promise<AuditRetentionConfig>;

  /**
   * Archive entries older than the retention period.
   * Moves entries to the archival destination and removes them from the active table.
   */
  archiveExpiredEntries(tenantId: string): Promise<ArchivalResult>;

  /**
   * Get the count of entries that would be archived based on current retention config.
   */
  getArchivalCandidateCount(tenantId: string): Promise<number>;

  /**
   * G-913: re-compute the tenant's hash chain from the genesis entry and
   * report the first break, if any.
   */
  verifyChain(tenantId: string): Promise<ChainVerification>;

  /**
   * G-913: tenants whose retention config has archival enabled — the runtime
   * retention scheduler iterates this list.
   */
  listTenantsWithArchivalEnabled(): Promise<string[]>;
}


