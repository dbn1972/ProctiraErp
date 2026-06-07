/**
 * In-Memory Audit Store
 *
 * An in-memory implementation of the AuditStore interface for testing.
 * Stores entries in a Map partitioned by month (YYYY-MM key).
 * Enforces append-only semantics — no update or delete methods are exposed.
 *
 * Requirements:
 * - 21.3: Append-only storage that prevents modification or deletion
 */

import { v4 as uuidv4 } from 'uuid';

import type { AuditEntry, CreateAuditEntryInput, AuditQueryFilter } from './types.js';
import type { AuditStore } from './audit-store.js';

/**
 * Extracts the YYYY-MM partition key from an ISO timestamp.
 */
function getPartitionKey(timestamp: string): string {
  return timestamp.slice(0, 7); // "2024-03" from "2024-03-15T10:30:00.000Z"
}

/**
 * In-memory audit store for testing purposes.
 * Entries are stored in a Map keyed by month partition.
 */
export class InMemoryAuditStore implements AuditStore {
  /** Partitioned storage: Map<YYYY-MM, AuditEntry[]> */
  private partitions: Map<string, AuditEntry[]> = new Map();

  /** Index by ID for fast lookups */
  private byId: Map<string, AuditEntry> = new Map();

  async append(input: CreateAuditEntryInput): Promise<AuditEntry> {
    const timestamp = new Date().toISOString();
    const entry: AuditEntry = {
      id: uuidv4(),
      entityType: input.entityType,
      entityId: input.entityId,
      tenantId: input.tenantId,
      userId: input.userId,
      operation: input.operation,
      changes: [...input.changes],
      timestamp,
      ipAddress: input.ipAddress,
    };

    const partitionKey = getPartitionKey(timestamp);
    const partition = this.partitions.get(partitionKey) ?? [];
    partition.push(entry);
    this.partitions.set(partitionKey, partition);
    this.byId.set(entry.id, entry);

    return entry;
  }

  async query(filter: AuditQueryFilter, limit = 100, offset = 0): Promise<AuditEntry[]> {
    const allEntries = this.getAllEntries();
    const filtered = allEntries.filter((entry) => this.matchesFilter(entry, filter));

    // Sort by timestamp descending (most recent first)
    filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return filtered.slice(offset, offset + limit);
  }

  async count(filter: AuditQueryFilter): Promise<number> {
    const allEntries = this.getAllEntries();
    return allEntries.filter((entry) => this.matchesFilter(entry, filter)).length;
  }

  async findById(id: string): Promise<AuditEntry | null> {
    return this.byId.get(id) ?? null;
  }

  /**
   * Get all entries across all partitions (for testing/querying).
   */
  private getAllEntries(): AuditEntry[] {
    const entries: AuditEntry[] = [];
    for (const partition of this.partitions.values()) {
      entries.push(...partition);
    }
    return entries;
  }

  /**
   * Check if an entry matches the given filter criteria.
   */
  private matchesFilter(entry: AuditEntry, filter: AuditQueryFilter): boolean {
    if (filter.entityType && entry.entityType !== filter.entityType) {
      return false;
    }
    if (filter.entityId && entry.entityId !== filter.entityId) {
      return false;
    }
    if (filter.tenantId && entry.tenantId !== filter.tenantId) {
      return false;
    }
    if (filter.userId && entry.userId !== filter.userId) {
      return false;
    }
    if (filter.operation && entry.operation !== filter.operation) {
      return false;
    }
    if (filter.fromDate && entry.timestamp < filter.fromDate) {
      return false;
    }
    if (filter.toDate && entry.timestamp > filter.toDate) {
      return false;
    }
    return true;
  }

  // --- Test helpers ---

  /**
   * Get the number of partitions (months) in the store.
   */
  getPartitionCount(): number {
    return this.partitions.size;
  }

  /**
   * Get entries for a specific partition (month).
   */
  getPartitionEntries(partitionKey: string): AuditEntry[] {
    return this.partitions.get(partitionKey) ?? [];
  }

  /**
   * Get total entry count across all partitions.
   */
  getTotalEntryCount(): number {
    let count = 0;
    for (const partition of this.partitions.values()) {
      count += partition.length;
    }
    return count;
  }

  /**
   * Clear all entries (for test cleanup).
   */
  clear(): void {
    this.partitions.clear();
    this.byId.clear();
  }
}
