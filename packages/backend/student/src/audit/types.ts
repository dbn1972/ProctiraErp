/**
 * Audit Trail Types
 *
 * Defines the core interfaces for the audit trail system.
 * This module captures all changes to student records (and can be extended
 * to other entity types) for compliance and accountability.
 *
 * Requirements:
 * - 6.6: Complete audit trail of all changes to student records
 * - 21.1: Record audit log entry for every create, update, delete on protected entities
 * - 21.2: Log authenticated user, timestamp, IP address, and affected entity
 */

/**
 * Represents a single field change within an audit entry.
 */
export interface AuditChange {
  /** The name of the field that was changed */
  field: string;
  /** The previous value (null for create operations) */
  oldValue: string | number | boolean | null;
  /** The new value (null for delete operations) */
  newValue: string | number | boolean | null;
}

/**
 * The type of operation that triggered the audit entry.
 */
export type AuditOperation = 'create' | 'update' | 'delete';

/**
 * A complete audit log entry capturing a single change event.
 */
export interface AuditEntry {
  /** Unique identifier for this audit entry */
  id: string;
  /** The type of entity being audited (e.g., 'student', 'enrollment', 'guardian') */
  entityType: string;
  /** The unique identifier of the entity being audited */
  entityId: string;
  /** The tenant this audit entry belongs to */
  tenantId: string;
  /** The authenticated user who made the change */
  userId: string;
  /** The type of operation performed */
  operation: AuditOperation;
  /** Array of field-level changes */
  changes: AuditChange[];
  /** ISO 8601 timestamp of when the change occurred */
  timestamp: string;
  /** IP address of the client that made the request */
  ipAddress: string;
}

/**
 * Input for creating a new audit entry (id and timestamp are auto-generated).
 */
export type CreateAuditEntryInput = Omit<AuditEntry, 'id' | 'timestamp'>;

/**
 * Filter options for querying audit entries.
 */
export interface AuditQueryFilter {
  /** Filter by entity type */
  entityType?: string;
  /** Filter by entity ID */
  entityId?: string;
  /** Filter by tenant */
  tenantId?: string;
  /** Filter by user who made the change */
  userId?: string;
  /** Filter by operation type */
  operation?: AuditOperation;
  /** Filter entries from this date (inclusive, ISO 8601) */
  fromDate?: string;
  /** Filter entries to this date (inclusive, ISO 8601) */
  toDate?: string;
}
