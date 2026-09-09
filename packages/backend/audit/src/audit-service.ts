/**
 * Audit Service
 *
 * Business logic for audit logging of entity changes.
 *
 * Requirements:
 * - 21.1: Record audit log entry for every create/update/delete on protected entities
 *         with before and after values.
 * - 21.2: Log authenticated user, timestamp, IP address, and affected entity.
 * - 21.3: Store in append-only storage preventing modification/deletion.
 * - 21.4: Support filtering by entity type, user, date range, operation type.
 * - 21.5: Configurable retention with automated archival of expired entries.
 */
import { BusinessRuleError, NotFoundError, ValidationError } from '@proctira/common';
import type { PaginatedResult } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  AuditRepository,
  AuditLogEntry,
  AuditLogQuery,
  AuditLogQueryResult,
  AuditOperation,
  AuditRetentionConfig,
  ArchivalResult,
  ChainVerification,
  CreateAuditLogInput,
} from './audit-repository.js';

/**
 * Input for recording a single audit event.
 */
export interface RecordAuditInput {
  /** Tenant context */
  tenantId: string;
  /** Entity type (e.g., 'student', 'institution', 'staff') */
  entityType: string;
  /** Entity unique identifier */
  entityId: string;
  /** Operation performed */
  operation: AuditOperation;
  /** Authenticated user ID */
  userId: string;
  /** Authenticated user display name */
  userName: string;
  /** Client IP address */
  ipAddress: string;
  /** State before the operation (null for CREATE) */
  beforeValues?: Record<string, unknown> | null;
  /** State after the operation (null for DELETE) */
  afterValues?: Record<string, unknown> | null;
  /** Optional metadata */
  metadata?: Record<string, unknown> | null;
}

/**
 * Input for querying audit logs.
 */
export interface QueryAuditInput {
  tenantId: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
  operation?: AuditOperation;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Input for configuring retention.
 */
export interface SetRetentionInput {
  tenantId: string;
  retentionMonths: number;
  archivalEnabled: boolean;
  archivalDestination?: string | null;
}

/**
 * Protected entity types that require audit logging.
 */
export const PROTECTED_ENTITY_TYPES = [
  'student',
  'staff',
  'institution',
  'enrollment',
  'assessment',
  'attendance',
  'examination',
  'scholarship',
  'health_record',
  'workflow',
  'user',
  'role',
  'permission',
  'academic_period',
  'custom_field',
] as const;

/**
 * Service handling audit logging business logic.
 */
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  /**
   * Record a single audit log entry.
   *
   * Validates:
   * - Entity type is a recognized protected entity
   * - Operation is valid (CREATE, UPDATE, DELETE)
   * - Required fields are present (userId, entityType, entityId)
   * - Before values are null for CREATE operations
   * - After values are null for DELETE operations
   *
   * Requirement 21.1: Record audit log entry for every create/update/delete
   * Requirement 21.2: Log authenticated user, timestamp, IP address, entity
   */
  async recordAudit(input: RecordAuditInput): Promise<AuditLogEntry> {
    // Validate operation-specific constraints
    this.validateAuditInput(input);

    const createInput: CreateAuditLogInput = {
      id: uuidv4(),
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      userId: input.userId,
      userName: input.userName,
      ipAddress: input.ipAddress,
      timestamp: new Date(),
      beforeValues: input.beforeValues ?? null,
      afterValues: input.afterValues ?? null,
      metadata: input.metadata ?? null,
    };

    return this.repository.create(createInput);
  }

  /**
   * Record multiple audit log entries in a batch.
   * Useful for bulk operations that affect multiple entities.
   */
  async recordAuditBatch(inputs: RecordAuditInput[]): Promise<AuditLogEntry[]> {
    const createInputs: CreateAuditLogInput[] = inputs.map((input) => {
      this.validateAuditInput(input);
      return {
        id: uuidv4(),
        tenantId: input.tenantId,
        entityType: input.entityType,
        entityId: input.entityId,
        operation: input.operation,
        userId: input.userId,
        userName: input.userName,
        ipAddress: input.ipAddress,
        timestamp: new Date(),
        beforeValues: input.beforeValues ?? null,
        afterValues: input.afterValues ?? null,
        metadata: input.metadata ?? null,
      };
    });

    return this.repository.createBatch(createInputs);
  }

  /**
   * Query audit log entries with filtering and pagination.
   *
   * Requirement 21.4: Support filtering by entity type, user, date range, operation type.
   */
  async queryAuditLogs(input: QueryAuditInput): Promise<AuditLogQueryResult> {
    // Validate date range if both provided
    if (input.startDate && input.endDate) {
      const start = new Date(input.startDate);
      const end = new Date(input.endDate);
      if (start > end) {
        throw new ValidationError('startDate must be before or equal to endDate', [
          {
            field: 'startDate',
            rule: 'range',
            message: 'startDate must be before or equal to endDate',
          },
        ]);
      }
    }

    const query: AuditLogQuery = {
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      userId: input.userId,
      operation: input.operation,
      startDate: input.startDate,
      endDate: input.endDate,
      page: input.page ?? 1,
      pageSize: Math.min(input.pageSize ?? 50, 100), // Cap at 100 per page
      sortOrder: input.sortOrder ?? 'desc',
    };

    return this.repository.query(query);
  }

  /**
   * Get a single audit log entry by ID.
   */
  async getAuditEntry(tenantId: string, id: string): Promise<AuditLogEntry> {
    const entry = await this.repository.findById(tenantId, id);
    if (!entry) {
      throw new NotFoundError(`Audit log entry '${id}' not found`);
    }
    return entry;
  }

  /**
   * Get the retention configuration for a tenant.
   *
   * Requirement 21.5: Configurable retention with automated archival.
   */
  async getRetentionConfig(tenantId: string): Promise<AuditRetentionConfig> {
    const config = await this.repository.getRetentionConfig(tenantId);
    if (!config) {
      // Return default configuration
      return {
        tenantId,
        retentionMonths: 84, // 7 years default
        archivalEnabled: false,
        archivalDestination: null,
        lastArchivalAt: null,
      };
    }
    return config;
  }

  /**
   * Set or update the retention configuration for a tenant.
   *
   * Requirement 21.5: Configurable retention with automated archival.
   */
  async setRetentionConfig(input: SetRetentionInput): Promise<AuditRetentionConfig> {
    if (input.retentionMonths < 1) {
      throw new ValidationError('Retention period must be at least 1 month', [
        {
          field: 'retentionMonths',
          rule: 'minimum',
          message: 'Retention period must be at least 1 month',
        },
      ]);
    }

    if (input.retentionMonths > 120) {
      throw new ValidationError('Retention period cannot exceed 120 months (10 years)', [
        {
          field: 'retentionMonths',
          rule: 'maximum',
          message: 'Retention period cannot exceed 120 months (10 years)',
        },
      ]);
    }

    if (input.archivalEnabled && !input.archivalDestination) {
      throw new ValidationError('Archival destination is required when archival is enabled', [
        {
          field: 'archivalDestination',
          rule: 'required',
          message: 'Archival destination is required when archival is enabled',
        },
      ]);
    }

    const existingConfig = await this.repository.getRetentionConfig(input.tenantId);

    const config: AuditRetentionConfig = {
      tenantId: input.tenantId,
      retentionMonths: input.retentionMonths,
      archivalEnabled: input.archivalEnabled,
      archivalDestination: input.archivalDestination ?? null,
      lastArchivalAt: existingConfig?.lastArchivalAt ?? null,
    };

    return this.repository.setRetentionConfig(config);
  }

  /**
   * Execute archival of expired audit log entries.
   *
   * Requirement 21.5: Automated archival of expired entries.
   */
  async executeArchival(tenantId: string): Promise<ArchivalResult> {
    const config = await this.repository.getRetentionConfig(tenantId);
    if (!config) {
      throw new BusinessRuleError(
        'No retention configuration found. Please configure retention before executing archival.',
      );
    }

    if (!config.archivalEnabled) {
      throw new BusinessRuleError(
        'Archival is not enabled for this tenant. Enable archival in retention configuration first.',
      );
    }

    return this.repository.archiveExpiredEntries(tenantId);
  }

  /**
   * Get the count of entries that would be archived.
   */
  async getArchivalCandidateCount(tenantId: string): Promise<number> {
    return this.repository.getArchivalCandidateCount(tenantId);
  }

  /**
   * G-913 — recompute the tenant's hash chain and report integrity.
   */
  async verifyChain(tenantId: string): Promise<ChainVerification> {
    if (!tenantId?.trim()) {
      throw new ValidationError('tenantId is required', [
        { field: 'tenantId', rule: 'required', message: 'tenantId is required' },
      ]);
    }
    return this.repository.verifyChain(tenantId);
  }

  /**
   * G-913 — runtime retention sweep: archive expired rows for every tenant
   * that enabled archival. Failures are isolated per tenant so one bad
   * tenant never blocks the others.
   */
  async runRetentionSweep(): Promise<{
    tenants: number;
    archived: number;
    failures: { tenantId: string; error: string }[];
  }> {
    const tenants = await this.repository.listTenantsWithArchivalEnabled();
    let archived = 0;
    const failures: { tenantId: string; error: string }[] = [];
    for (const tenantId of tenants) {
      try {
        const result = await this.repository.archiveExpiredEntries(tenantId);
        archived += result.archivedCount;
      } catch (error) {
        failures.push({ tenantId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { tenants: tenants.length, archived, failures };
  }

  /**
   * G-734 — Data Subject Access Request (DSAR) export.
   *
   * Collects every audit entry for a subject within the tenant where the
   * subject appears as the entity id or as the acting user. Pages through
   * the repository so the package is complete up to the configured ceiling.
   */
  async exportDataSubjectPackage(
    tenantId: string,
    subjectId: string,
    options: { maxEntries?: number } = {},
  ): Promise<{
    subjectId: string;
    tenantId: string;
    exportedAt: string;
    entryCount: number;
    truncated: boolean;
    entries: AuditLogEntry[];
  }> {
    if (!tenantId?.trim()) {
      throw new ValidationError('tenantId is required', [
        { field: 'tenantId', rule: 'required', message: 'tenantId is required' },
      ]);
    }
    if (!subjectId?.trim()) {
      throw new ValidationError('subjectId is required', [
        { field: 'subjectId', rule: 'required', message: 'subjectId is required' },
      ]);
    }

    const maxEntries = Math.min(Math.max(options.maxEntries ?? 5_000, 1), 10_000);
    const pageSize = 100;
    const byId = new Map<string, AuditLogEntry>();

    const collect = async (filter: { entityId?: string; userId?: string }) => {
      let page = 1;
      for (;;) {
        if (byId.size >= maxEntries) return;
        const result = await this.repository.query({
          tenantId,
          ...filter,
          page,
          pageSize,
          sortOrder: 'desc',
        });
        for (const entry of result.data) {
          byId.set(entry.id, entry);
          if (byId.size >= maxEntries) return;
        }
        if (page >= result.meta.totalPages || result.data.length === 0) return;
        page += 1;
      }
    };

    await collect({ entityId: subjectId });
    await collect({ userId: subjectId });

    const entries = Array.from(byId.values()).sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );

    return {
      subjectId,
      tenantId,
      exportedAt: new Date().toISOString(),
      entryCount: entries.length,
      truncated: entries.length >= maxEntries,
      entries,
    };
  }

  /**
   * Validate audit input for operation-specific constraints.
   */
  private validateAuditInput(input: RecordAuditInput): void {
    const errors: Array<{ field: string; rule: string; message: string }> = [];

    if (!input.tenantId) {
      errors.push({ field: 'tenantId', rule: 'required', message: 'tenantId is required' });
    }

    if (!input.entityType) {
      errors.push({ field: 'entityType', rule: 'required', message: 'entityType is required' });
    }

    if (!input.entityId) {
      errors.push({ field: 'entityId', rule: 'required', message: 'entityId is required' });
    }

    if (!input.userId) {
      errors.push({ field: 'userId', rule: 'required', message: 'userId is required' });
    }

    if (!input.ipAddress) {
      errors.push({ field: 'ipAddress', rule: 'required', message: 'ipAddress is required' });
    }

    // Validate operation-specific value constraints
    if (input.operation === 'CREATE' && input.beforeValues != null) {
      errors.push({
        field: 'beforeValues',
        rule: 'invalid',
        message: 'beforeValues must be null for CREATE operations',
      });
    }

    if (input.operation === 'DELETE' && input.afterValues != null) {
      errors.push({
        field: 'afterValues',
        rule: 'invalid',
        message: 'afterValues must be null for DELETE operations',
      });
    }

    if (input.operation === 'UPDATE') {
      if (input.beforeValues == null) {
        errors.push({
          field: 'beforeValues',
          rule: 'required',
          message: 'beforeValues is required for UPDATE operations',
        });
      }
      if (input.afterValues == null) {
        errors.push({
          field: 'afterValues',
          rule: 'required',
          message: 'afterValues is required for UPDATE operations',
        });
      }
    }

    if (errors.length > 0) {
      throw new ValidationError('Invalid audit input', errors);
    }
  }
}
