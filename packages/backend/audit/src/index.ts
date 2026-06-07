/**
 * @proctira/backend-audit - Audit trail service
 *
 * Provides comprehensive audit logging for all entity changes with:
 * - Recording of create/update/delete operations on protected entities
 * - Capture of authenticated user, timestamp, IP address, entity type/ID, operation
 * - Before and after values for change tracking
 * - Append-only PostgreSQL storage partitioned by month
 * - Query routes with filtering by entity type, user, date range, operation type
 * - Configurable retention with automated archival of expired entries
 *
 * Requirements: 21.1, 21.2, 21.3, 21.4, 21.5
 */

// Plugin
export { auditPlugin } from './audit-plugin.js';
export type { AuditPluginOptions } from './audit-plugin.js';

// Service
export { AuditService, PROTECTED_ENTITY_TYPES } from './audit-service.js';
export type {
  RecordAuditInput,
  QueryAuditInput,
  SetRetentionInput,
} from './audit-service.js';

// Repository
export type {
  AuditRepository,
  AuditLogEntry,
  CreateAuditLogInput,
  AuditLogQuery,
  AuditLogQueryResult,
  AuditOperation,
  AuditRetentionConfig,
  ArchivalResult,
} from './audit-repository.js';

// In-memory repository (for testing)
export { InMemoryAuditRepository } from './in-memory-repository.js';

// Schemas
export {
  RecordAuditSchema,
  RecordAuditBatchSchema,
  QueryAuditLogsSchema,
  AuditEntryParamsSchema,
  SetRetentionConfigSchema,
  AuditLogEntryResponseSchema,
  AuditLogQueryResponseSchema,
  RetentionConfigResponseSchema,
  ArchivalResultResponseSchema,
  ArchivalCandidateCountResponseSchema,
} from './schemas.js';
export type {
  RecordAuditInput as RecordAuditSchemaInput,
  RecordAuditBatchInput,
  QueryAuditLogsInput,
  AuditEntryParams,
  SetRetentionConfigInput,
  AuditLogEntryResponse,
  AuditLogQueryResponse,
  RetentionConfigResponse,
  ArchivalResultResponse,
  ArchivalCandidateCountResponse,
} from './schemas.js';

// Routes
export { registerAuditRoutes } from './routes.js';
export type { AuditRoutesOptions } from './routes.js';
