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
 * Fetches a paginated, filterable list of audit entries from the backend.
 */
export async function listAuditEntries(
  filters: AuditEntriesFilter = {},
): Promise<AuditEntriesResponse> {
  const params = new URLSearchParams();
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.operation) params.set('operation', filters.operation);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.entityId) params.set('entityId', filters.entityId);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const query = params.size ? `?${params.toString()}` : '';
  return browserGatewayFetch<AuditEntriesResponse>(`/audit/entries${query}`);
}

/**
 * Fetches a single audit entry by ID.
 */
export async function getAuditEntry(entryId: string): Promise<AuditEntry> {
  return browserGatewayFetch<AuditEntry>(`/audit/entries/${encodeURIComponent(entryId)}`);
}

/**
 * Returns the list of distinct entity types present in the audit log.
 * Used to populate the entity type filter dropdown.
 */
export async function listAuditEntityTypes(): Promise<string[]> {
  const result = await browserGatewayFetch<{ data: string[] }>('/audit/entity-types');
  return result.data;
}
