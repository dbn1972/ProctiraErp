/**
 * Audit Service Schemas
 *
 * Typebox schemas for request/response validation on audit routes.
 *
 * Requirements:
 * - 21.1: Record audit log entry for every create/update/delete
 * - 21.2: Log authenticated user, timestamp, IP address, entity
 * - 21.4: Query with filtering by entity type, user, date range, operation type
 * - 21.5: Configurable retention with automated archival
 */
import { Type, type Static } from '@sinclair/typebox';

// --- Shared Enums ---

const AuditOperationEnum = Type.Union([
  Type.Literal('CREATE'),
  Type.Literal('UPDATE'),
  Type.Literal('DELETE'),
]);

// --- Request Schemas ---

/**
 * Schema for recording a single audit log entry.
 */
export const RecordAuditSchema = Type.Object({
  entityType: Type.String({ minLength: 1, maxLength: 100 }),
  entityId: Type.String({ minLength: 1, maxLength: 255 }),
  operation: AuditOperationEnum,
  beforeValues: Type.Optional(
    Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  ),
  afterValues: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
  metadata: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
});

export type RecordAuditInput = Static<typeof RecordAuditSchema>;

/**
 * Schema for recording multiple audit log entries in a batch.
 */
export const RecordAuditBatchSchema = Type.Object({
  entries: Type.Array(RecordAuditSchema, { minItems: 1, maxItems: 100 }),
});

export type RecordAuditBatchInput = Static<typeof RecordAuditBatchSchema>;

/**
 * Schema for querying audit logs with filters.
 */
export const QueryAuditLogsSchema = Type.Object({
  entityType: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  entityId: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  userId: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  operation: Type.Optional(AuditOperationEnum),
  startDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  endDate: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 50 })),
  sortOrder: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
});

export type QueryAuditLogsInput = Static<typeof QueryAuditLogsSchema>;

/**
 * Schema for the audit entry ID path parameter.
 */
export const AuditEntryParamsSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
});

export type AuditEntryParams = Static<typeof AuditEntryParamsSchema>;

/**
 * Schema for setting retention configuration.
 *
 * PRC-L256 / PRC-L295: the platform floor for audit retention is 12 months and a
 * tenant cannot lower it. The floor is enforced at three layers so it cannot be
 * bypassed: the DB CHECK (`db/sql/243_audit_retention_floor.sql`,
 * `CHECK (retention_months >= 12)`), the server service floor
 * (`AuditService.setRetentionConfig`) and this API minimum. Previously this schema
 * advertised `minimum: 1`, so the API contract accepted a below-floor value and
 * rejection only happened deeper in the service; the minimum now matches the DB
 * CHECK and the web UI minimum (AUDIT_RETENTION_HARD_FLOOR_MONTHS = 12).
 */
export const AUDIT_RETENTION_FLOOR_MONTHS = 12;
export const AUDIT_RETENTION_MAX_MONTHS = 120;

export const SetRetentionConfigSchema = Type.Object({
  retentionMonths: Type.Number({
    minimum: AUDIT_RETENTION_FLOOR_MONTHS,
    maximum: AUDIT_RETENTION_MAX_MONTHS,
  }),
  archivalEnabled: Type.Boolean(),
  archivalDestination: Type.Optional(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
});

export type SetRetentionConfigInput = Static<typeof SetRetentionConfigSchema>;

// --- Response Schemas ---

/**
 * Schema for a single audit log entry response.
 */
export const AuditLogEntryResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  entityType: Type.String(),
  entityId: Type.String(),
  operation: AuditOperationEnum,
  userId: Type.String(),
  userName: Type.String(),
  ipAddress: Type.String(),
  timestamp: Type.String(),
  beforeValues: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  afterValues: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  metadata: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
});

export type AuditLogEntryResponse = Static<typeof AuditLogEntryResponseSchema>;

/**
 * Schema for paginated audit log query response.
 */
export const AuditLogQueryResponseSchema = Type.Object({
  data: Type.Array(AuditLogEntryResponseSchema),
  meta: Type.Object({
    page: Type.Number(),
    pageSize: Type.Number(),
    totalItems: Type.Number(),
    totalPages: Type.Number(),
  }),
});

export type AuditLogQueryResponse = Static<typeof AuditLogQueryResponseSchema>;

/**
 * Schema for retention configuration response.
 */
export const RetentionConfigResponseSchema = Type.Object({
  tenantId: Type.String(),
  retentionMonths: Type.Number(),
  archivalEnabled: Type.Boolean(),
  archivalDestination: Type.Union([Type.String(), Type.Null()]),
  lastArchivalAt: Type.Union([Type.String(), Type.Null()]),
});

export type RetentionConfigResponse = Static<typeof RetentionConfigResponseSchema>;

/**
 * Schema for archival result response.
 */
export const ArchivalResultResponseSchema = Type.Object({
  archivedCount: Type.Number(),
  cutoffDate: Type.String(),
  destination: Type.String(),
  executedAt: Type.String(),
});

export type ArchivalResultResponse = Static<typeof ArchivalResultResponseSchema>;

/**
 * Schema for archival candidate count response.
 */
export const ArchivalCandidateCountResponseSchema = Type.Object({
  count: Type.Number(),
});

export type ArchivalCandidateCountResponse = Static<typeof ArchivalCandidateCountResponseSchema>;
