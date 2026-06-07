/**
 * Audit Store Interface
 *
 * Defines the persistence contract for audit entries.
 * Implementations must provide append-only storage semantics —
 * entries can be added and queried but never modified or deleted.
 *
 * Requirements:
 * - 21.1: Record audit log entry for every create, update, delete
 * - 21.3: Append-only storage that prevents modification or deletion
 */

import type { AuditEntry, CreateAuditEntryInput, AuditQueryFilter } from './types.js';

/**
 * Persistence interface for audit entries.
 *
 * All implementations must guarantee:
 * - Entries are append-only (no update or delete operations)
 * - Entries are partitioned by month for efficient querying
 * - Entries are immutable once written
 */
export interface AuditStore {
  /**
   * Append a new audit entry to the store.
   * The store assigns an ID and timestamp to the entry.
   *
   * @param input - The audit entry data (without id and timestamp)
   * @returns The complete audit entry with generated id and timestamp
   */
  append(input: CreateAuditEntryInput): Promise<AuditEntry>;

  /**
   * Query audit entries matching the given filter criteria.
   * Results are ordered by timestamp descending (most recent first).
   *
   * @param filter - Filter criteria for the query
   * @param limit - Maximum number of entries to return (default 100)
   * @param offset - Number of entries to skip for pagination (default 0)
   * @returns Array of matching audit entries
   */
  query(filter: AuditQueryFilter, limit?: number, offset?: number): Promise<AuditEntry[]>;

  /**
   * Count audit entries matching the given filter criteria.
   *
   * @param filter - Filter criteria for the count
   * @returns Total number of matching entries
   */
  count(filter: AuditQueryFilter): Promise<number>;

  /**
   * Get a single audit entry by ID.
   *
   * @param id - The audit entry ID
   * @returns The audit entry or null if not found
   */
  findById(id: string): Promise<AuditEntry | null>;
}
