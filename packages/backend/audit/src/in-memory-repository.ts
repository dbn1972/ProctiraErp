/**
 * In-Memory Audit Repository
 *
 * Test implementation of the AuditRepository interface.
 * Stores audit log entries in memory for unit and property-based testing.
 */
import type {
  AuditRepository,
  AuditLogEntry,
  CreateAuditLogInput,
  AuditLogQuery,
  AuditLogQueryResult,
  AuditRetentionConfig,
  ArchivalResult,
} from './audit-repository.js';

/**
 * In-memory implementation of AuditRepository for testing purposes.
 * Simulates append-only behavior and partitioned storage.
 */
export class InMemoryAuditRepository implements AuditRepository {
  private entries: AuditLogEntry[] = [];
  private archivedEntries: AuditLogEntry[] = [];
  private retentionConfigs: Map<string, AuditRetentionConfig> = new Map();

  /**
   * Create a new audit log entry (append-only).
   */
  async create(input: CreateAuditLogInput): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
      id: input.id,
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      userId: input.userId,
      userName: input.userName,
      ipAddress: input.ipAddress,
      timestamp: input.timestamp,
      beforeValues: input.beforeValues,
      afterValues: input.afterValues,
      metadata: input.metadata ?? null,
    };

    this.entries.push(entry);
    return entry;
  }

  /**
   * Create multiple audit log entries in a batch.
   */
  async createBatch(inputs: CreateAuditLogInput[]): Promise<AuditLogEntry[]> {
    const results: AuditLogEntry[] = [];
    for (const input of inputs) {
      const entry = await this.create(input);
      results.push(entry);
    }
    return results;
  }

  /**
   * Query audit log entries with filtering and pagination.
   */
  async query(query: AuditLogQuery): Promise<AuditLogQueryResult> {
    let filtered = this.entries.filter(e => e.tenantId === query.tenantId);

    if (query.entityType) {
      filtered = filtered.filter(e => e.entityType === query.entityType);
    }

    if (query.entityId) {
      filtered = filtered.filter(e => e.entityId === query.entityId);
    }

    if (query.userId) {
      filtered = filtered.filter(e => e.userId === query.userId);
    }

    if (query.operation) {
      filtered = filtered.filter(e => e.operation === query.operation);
    }

    if (query.startDate) {
      const start = new Date(query.startDate + 'T00:00:00.000Z');
      filtered = filtered.filter(e => e.timestamp >= start);
    }

    if (query.endDate) {
      const end = new Date(query.endDate + 'T23:59:59.999Z');
      filtered = filtered.filter(e => e.timestamp <= end);
    }

    // Sort by timestamp
    const sortOrder = query.sortOrder ?? 'desc';
    filtered.sort((a, b) => {
      const diff = a.timestamp.getTime() - b.timestamp.getTime();
      return sortOrder === 'asc' ? diff : -diff;
    });

    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / query.pageSize) || 1;
    const offset = (query.page - 1) * query.pageSize;
    const data = filtered.slice(offset, offset + query.pageSize);

    return {
      data,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems,
        totalPages,
      },
    };
  }

  /**
   * Get a single audit log entry by ID.
   */
  async findById(tenantId: string, id: string): Promise<AuditLogEntry | null> {
    return this.entries.find(e => e.id === id && e.tenantId === tenantId) ?? null;
  }

  /**
   * Get the retention configuration for a tenant.
   */
  async getRetentionConfig(tenantId: string): Promise<AuditRetentionConfig | null> {
    return this.retentionConfigs.get(tenantId) ?? null;
  }

  /**
   * Set or update the retention configuration for a tenant.
   */
  async setRetentionConfig(config: AuditRetentionConfig): Promise<AuditRetentionConfig> {
    this.retentionConfigs.set(config.tenantId, config);
    return config;
  }

  /**
   * Archive entries older than the retention period.
   */
  async archiveExpiredEntries(tenantId: string): Promise<ArchivalResult> {
    const config = this.retentionConfigs.get(tenantId);
    if (!config || !config.archivalEnabled) {
      return {
        archivedCount: 0,
        cutoffDate: new Date(),
        destination: '',
        executedAt: new Date(),
      };
    }

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - config.retentionMonths);

    const toArchive = this.entries.filter(
      e => e.tenantId === tenantId && e.timestamp < cutoffDate,
    );

    // Move to archived
    this.archivedEntries.push(...toArchive);

    // Remove from active entries
    this.entries = this.entries.filter(
      e => !(e.tenantId === tenantId && e.timestamp < cutoffDate),
    );

    // Update last archival timestamp
    config.lastArchivalAt = new Date();
    this.retentionConfigs.set(tenantId, config);

    return {
      archivedCount: toArchive.length,
      cutoffDate,
      destination: config.archivalDestination ?? 'in-memory-archive',
      executedAt: new Date(),
    };
  }

  /**
   * Get the count of entries that would be archived.
   */
  async getArchivalCandidateCount(tenantId: string): Promise<number> {
    const config = this.retentionConfigs.get(tenantId);
    if (!config || !config.archivalEnabled) {
      return 0;
    }

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - config.retentionMonths);

    return this.entries.filter(
      e => e.tenantId === tenantId && e.timestamp < cutoffDate,
    ).length;
  }

  // --- Test helpers ---

  /**
   * Get all entries (for test assertions).
   */
  getAllEntries(): AuditLogEntry[] {
    return [...this.entries];
  }

  /**
   * Get all archived entries (for test assertions).
   */
  getArchivedEntries(): AuditLogEntry[] {
    return [...this.archivedEntries];
  }

  /**
   * Clear all data (for test setup/teardown).
   */
  clear(): void {
    this.entries = [];
    this.archivedEntries = [];
    this.retentionConfigs.clear();
  }
}
