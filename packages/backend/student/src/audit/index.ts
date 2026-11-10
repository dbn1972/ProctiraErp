/**
 * Audit Trail Module
 *
 * Provides audit logging for student record changes. In the runtime the audit
 * trail is written to the platform's durable, tamper-evident chained store via
 * {@link DurableAuditStore} (PRC-L590). `InMemoryAuditStore` is a test-only
 * store and is intentionally not re-exported here as a production path.
 */
export type { AuditStore } from './audit-store.js';
export { AuditService } from './audit-service.js';
export type { AuditContext, RecordAuditOptions } from './audit-service.js';
export { DurableAuditStore } from './durable-audit-store.js';
export type {
  DurableAuditAppend,
  DurableAuditAppendInput,
  DurableAuditReadPorts,
  DurableAuditRecord,
  DurableAuditStoreOptions,
} from './durable-audit-store.js';
export type {
  AuditEntry,
  AuditChange,
  AuditOperation,
  CreateAuditEntryInput,
  AuditQueryFilter,
} from './types.js';
