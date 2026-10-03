/**
 * Audit Service client (Task 60A.10 — Audit-trail viewer).
 *
 * Provides browser-side helpers for querying the audit backend API
 * (`GET /api/v1/audit/entries`). Uses `browserGatewayFetch` for
 * authenticated requests from client components.
 *
 * Validates: Requirements 21.1, 21.2, 21.3, 21.4
 */

import { browserGatewayFetch } from './browser-gateway';

// ─── Types ───────────────────────────────────────────────────────────────

/** Supported audit operations. */
export type AuditOperation = 'CREATE' | 'UPDATE' | 'DELETE';

/** A single audit entry as returned by the backend. */
export interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  operation: AuditOperation;
  userId: string;
  userDisplayName: string;
  ipAddress: string | null;
  timestamp: string;
  /** Changed fields with before/after values. */
  changes: AuditFieldChange[];
  /** Optional metadata (risk level, summary, etc.). */
  metadata: Record<string, unknown> | null;
}

/** A single field-level change within an audit entry. */
export interface AuditFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** Pagination metadata returned alongside audit entries. */
export interface AuditPaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/** Paginated response from the audit entries endpoint. */
export interface AuditEntriesResponse {
  data: AuditEntry[];
  meta: AuditPaginationMeta;
}

/** Filter parameters for querying audit entries. */
export interface AuditEntriesFilter {
  entityType?: string;
  userId?: string;
  operation?: AuditOperation;
  dateFrom?: string;
  dateTo?: string;
  entityId?: string;
  page?: number;
  pageSize?: number;
}

// ─── API Functions ───────────────────────────────────────────────────────

/**
 * PRC-M576: the gateway mounts the audit plugin at `/api/v1/audit-logs`
 * (GET list, GET /entity-types, GET /:id). `/audit/entries` never existed.
 */
export const AUDIT_LOGS_PATH = '/audit-logs';

/** Wire shape returned by packages/backend/audit `formatAuditEntryResponse`. */
interface AuditLogWireEntry {
  id: string;
  entityType: string;
  entityId: string;
  operation: AuditOperation;
  userId: string;
  userName?: string | null;
  ipAddress?: string | null;
  timestamp: string;
  beforeValues?: Record<string, unknown> | null;
  afterValues?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

function diffChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): AuditFieldChange[] {
  const fields = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changes: AuditFieldChange[] = [];
  for (const field of [...fields].sort()) {
    const b = before?.[field];
    const a = after?.[field];
    if (JSON.stringify(b) !== JSON.stringify(a)) changes.push({ field, before: b, after: a });
  }
  return changes;
}

/** Map the backend audit entry onto the viewer's `AuditEntry` shape. */
export function toAuditEntry(wire: AuditLogWireEntry): AuditEntry {
  return {
    id: wire.id,
    entityType: wire.entityType,
    entityId: wire.entityId,
    operation: wire.operation,
    userId: wire.userId,
    userDisplayName: wire.userName || wire.userId,
    ipAddress: wire.ipAddress ?? null,
    timestamp: wire.timestamp,
    changes: diffChanges(wire.beforeValues, wire.afterValues),
    metadata: wire.metadata ?? null,
  };
}

/** Builds the list URL (exported for the contract test). */
export function buildAuditEntriesPath(filters: AuditEntriesFilter = {}): string {
  const params = new URLSearchParams();
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.operation) params.set('operation', filters.operation);
  // Backend accepts YYYY-MM-DD startDate/endDate (inclusive end).
  if (filters.dateFrom) params.set('startDate', filters.dateFrom.slice(0, 10));
  if (filters.dateTo) params.set('endDate', filters.dateTo.slice(0, 10));
  if (filters.entityId) params.set('entityId', filters.entityId);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const query = params.toString();
  return `${AUDIT_LOGS_PATH}${query ? `?${query}` : ''}`;
}

/**
 * Fetches a paginated, filterable list of audit entries from the backend.
 */
export async function listAuditEntries(
  filters: AuditEntriesFilter = {},
): Promise<AuditEntriesResponse> {
  const result = await browserGatewayFetch<{ data: AuditLogWireEntry[]; meta: AuditPaginationMeta }>(
    buildAuditEntriesPath(filters),
  );
  return { data: result.data.map(toAuditEntry), meta: result.meta };
}

/**
 * Fetches a single audit entry by ID.
 */
export async function getAuditEntry(entryId: string): Promise<AuditEntry> {
  const wire = await browserGatewayFetch<AuditLogWireEntry>(
    `${AUDIT_LOGS_PATH}/${encodeURIComponent(entryId)}`,
  );
  return toAuditEntry(wire);
}

/**
 * Returns the list of distinct entity types present in the audit log.
 * Used to populate the entity type filter dropdown.
 */
export async function listAuditEntityTypes(): Promise<string[]> {
  const result = await browserGatewayFetch<{ data: string[] }>(`${AUDIT_LOGS_PATH}/entity-types`);
  return result.data;
}
