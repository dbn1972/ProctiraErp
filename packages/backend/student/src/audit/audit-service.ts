/**
 * Audit Service
 *
 * Provides a high-level API for recording audit entries when student
 * records (or other entities) are created, updated, or deleted.
 * Integrates with the AuditStore for persistence and uses the diff
 * utility to automatically detect changes.
 *
 * Requirements:
 * - 6.6: Complete audit trail of all changes to student records
 * - 21.1: Record audit log entry for every create, update, delete
 * - 21.2: Log authenticated user, timestamp, IP address, affected entity
 */

import type { AuditStore } from './audit-store.js';
import type { AuditEntry, AuditOperation, AuditQueryFilter } from './types.js';
import { generateChanges } from './diff.js';
import type { AuditableRecord, DiffOptions } from './diff.js';

/**
 * Context about the user and request that triggered the change.
 */
export interface AuditContext {
  /** The authenticated user's ID */
  userId: string;
  /** The tenant ID */
  tenantId: string;
  /** The IP address of the client */
  ipAddress: string;
}

/**
 * Options for recording an audit entry.
 */
export interface RecordAuditOptions {
  /** The type of entity being audited (e.g., 'student', 'enrollment') */
  entityType: string;
  /** The unique identifier of the entity */
  entityId: string;
  /** The operation being performed */
  operation: AuditOperation;
  /** The previous state of the entity (empty object for create) */
  oldState: AuditableRecord;
  /** The new state of the entity (empty object for delete) */
  newState: AuditableRecord;
  /** Diff options (e.g., fields to exclude) */
  diffOptions?: DiffOptions;
}

/**
 * Service for recording and querying audit trail entries.
 */
export class AuditService {
  constructor(private readonly store: AuditStore) {}

  /**
   * Record an audit entry for a change to an entity.
   *
   * Automatically computes the diff between old and new states.
   * For create operations, pass an empty object as oldState.
   * For delete operations, pass an empty object as newState.
   *
   * @param context - The user/request context
   * @param options - Details about the entity and change
   * @returns The created audit entry, or null if no changes were detected
   */
  async record(context: AuditContext, options: RecordAuditOptions): Promise<AuditEntry | null> {
    const changes = generateChanges(options.oldState, options.newState, options.diffOptions);

    // For update operations, skip if no actual changes detected
    if (options.operation === 'update' && changes.length === 0) {
      return null;
    }

    const entry = await this.store.append({
      entityType: options.entityType,
      entityId: options.entityId,
      tenantId: context.tenantId,
      userId: context.userId,
      operation: options.operation,
      changes,
      ipAddress: context.ipAddress,
    });

    return entry;
  }

  /**
   * Record a create operation.
   * Convenience method that sets operation to 'create' and oldState to empty.
   */
  async recordCreate(
    context: AuditContext,
    entityType: string,
    entityId: string,
    newState: AuditableRecord,
    diffOptions?: DiffOptions,
  ): Promise<AuditEntry> {
    const entry = await this.record(context, {
      entityType,
      entityId,
      operation: 'create',
      oldState: {},
      newState,
      diffOptions,
    });

    // Create operations always produce an entry (unless newState is empty)
    return entry!;
  }

  /**
   * Record an update operation.
   * Convenience method that sets operation to 'update'.
   * Returns null if no changes were detected.
   */
  async recordUpdate(
    context: AuditContext,
    entityType: string,
    entityId: string,
    oldState: AuditableRecord,
    newState: AuditableRecord,
    diffOptions?: DiffOptions,
  ): Promise<AuditEntry | null> {
    return this.record(context, {
      entityType,
      entityId,
      operation: 'update',
      oldState,
      newState,
      diffOptions,
    });
  }

  /**
   * Record a delete operation.
   * Convenience method that sets operation to 'delete' and newState to empty.
   */
  async recordDelete(
    context: AuditContext,
    entityType: string,
    entityId: string,
    oldState: AuditableRecord,
    diffOptions?: DiffOptions,
  ): Promise<AuditEntry> {
    const entry = await this.record(context, {
      entityType,
      entityId,
      operation: 'delete',
      oldState,
      newState: {},
      diffOptions,
    });

    // Delete operations always produce an entry (unless oldState is empty)
    return entry!;
  }

  /**
   * Query audit entries with filtering.
   */
  async query(filter: AuditQueryFilter, limit?: number, offset?: number): Promise<AuditEntry[]> {
    return this.store.query(filter, limit, offset);
  }

  /**
   * Count audit entries matching a filter.
   */
  async count(filter: AuditQueryFilter): Promise<number> {
    return this.store.count(filter);
  }

  /**
   * Get a single audit entry by ID.
   */
  async findById(id: string): Promise<AuditEntry | null> {
    return this.store.findById(id);
  }
}
