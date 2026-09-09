/**
 * Server-side clients for the platform-scoped gateway surfaces that the web
 * app renders under `/billing`, `/audit-logs` and `/tenant-lifecycle` (G-727).
 *
 * All three prefixes map to the synthetic `platform` RBAC resource, so a
 * tenant-level administrator receives 403. That case is surfaced as
 * `access: 'forbidden'` rather than being folded into the scaffold banner —
 * "the gateway said no" and "the gateway is unreachable" are different
 * operator situations and must not be confused.
 */
import { gatewayFetch } from './gateway';
import type { ScaffoldDataSource } from './insights-source';
import { scaffoldSourceFromResponse } from './insights-source';

export type PlatformAccess = 'ok' | 'forbidden';

export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface PlatformListResult<T> {
  data: T[];
  meta: PageMeta;
  source: ScaffoldDataSource;
  access: PlatformAccess;
  /** Gateway error code when the request was reached but failed. */
  errorCode?: string;
}

const EMPTY_META: PageMeta = { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 };

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : '';
}

async function fetchPlatformList<T>(
  path: string,
  map: (raw: Record<string, unknown>) => T,
): Promise<PlatformListResult<T>> {
  const result = await gatewayFetch<{ data?: Record<string, unknown>[]; meta?: Partial<PageMeta> }>(
    path,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  const source = scaffoldSourceFromResponse(result.ok, result.status);
  if (result.status === 403) {
    return {
      data: [],
      meta: EMPTY_META,
      source,
      access: 'forbidden',
      errorCode: result.error?.code,
    };
  }
  if (!result.ok) {
    return {
      data: [],
      meta: EMPTY_META,
      source,
      access: 'ok',
      ...(result.error?.code ? { errorCode: result.error.code } : {}),
    };
  }
  const rows = result.data?.data ?? [];
  const meta = { ...EMPTY_META, ...(result.data?.meta ?? {}) };
  return { data: rows.map(map), meta, source, access: 'ok' };
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

// ─── Billing ─────────────────────────────────────────────────────────────

/** Known values: free | starter | professional | enterprise — open for gateway additions. */
export type BillingPlanTier = string;
/** Known values: active | deprecated | draft. */
export type BillingPlanStatus = string;

export interface BillingPlan {
  id: string;
  name: string;
  description: string;
  tier: BillingPlanTier;
  status: BillingPlanStatus;
  features: string[];
  quotas: Record<string, number>;
  priceMonthly: number;
  priceYearly: number;
  trialDays: number;
  sortOrder: number;
  updatedAt: string;
}

/**
 * Gateway shape: `features: [{ featureKey, enabled, description? }]`,
 * `quotas: [{ metric, limit, description? }]` (`limit` -1 = unlimited).
 * Only enabled features are listed; quotas are keyed by metric.
 */
function mapPlan(raw: Record<string, unknown>): BillingPlan {
  const features: string[] = [];
  if (Array.isArray(raw['features'])) {
    for (const f of raw['features'] as unknown[]) {
      if (f && typeof f === 'object') {
        const feature = f as { featureKey?: unknown; enabled?: unknown };
        if (feature.enabled !== false && typeof feature.featureKey === 'string') {
          features.push(feature.featureKey);
        }
      } else if (typeof f === 'string') {
        features.push(f);
      }
    }
  }
  const quotas: Record<string, number> = {};
  if (Array.isArray(raw['quotas'])) {
    for (const q of raw['quotas'] as unknown[]) {
      if (q && typeof q === 'object') {
        const quota = q as { metric?: unknown; limit?: unknown };
        if (typeof quota.metric === 'string' && typeof quota.limit === 'number') {
          quotas[quota.metric] = quota.limit;
        }
      }
    }
  }
  return {
    id: str(raw['id']),
    name: str(raw['name']),
    description: str(raw['description']),
    tier: str(raw['tier'], 'free'),
    status: str(raw['status'], 'active'),
    features,
    quotas,
    priceMonthly: num(raw['priceMonthly']),
    priceYearly: num(raw['priceYearly']),
    trialDays: num(raw['trialDays']),
    sortOrder: num(raw['sortOrder']),
    updatedAt: str(raw['updatedAt']),
  };
}

export interface BillingPlanFilters {
  tier?: string;
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function listBillingPlans(filters: BillingPlanFilters = {}) {
  return fetchPlatformList<BillingPlan>(
    `/billing/plans${toQuery({
      tier: filters.tier,
      status: filters.status,
      search: filters.search,
      page: filters.page,
      pageSize: filters.pageSize,
    })}`,
    mapPlan,
  );
}

// ─── Audit logs ──────────────────────────────────────────────────────────

/** Known values: CREATE | UPDATE | DELETE. */
export type AuditOperation = string;

export interface AuditLogEntry {
  id: string;
  entityType: string;
  entityId: string;
  operation: AuditOperation;
  userId: string;
  userName: string;
  ipAddress: string | null;
  timestamp: string;
  changedFields: string[];
}

function changedFields(raw: Record<string, unknown>): string[] {
  const before = (raw['beforeValues'] ?? {}) as Record<string, unknown>;
  const after = (raw['afterValues'] ?? {}) as Record<string, unknown>;
  const keys = new Set<string>([
    ...(typeof before === 'object' && before ? Object.keys(before) : []),
    ...(typeof after === 'object' && after ? Object.keys(after) : []),
  ]);
  return Array.from(keys)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .sort();
}

function mapAuditEntry(raw: Record<string, unknown>): AuditLogEntry {
  return {
    id: str(raw['id']),
    entityType: str(raw['entityType']),
    entityId: str(raw['entityId']),
    operation: str(raw['operation'], 'UPDATE'),
    userId: str(raw['userId']),
    userName: str(raw['userName'], 'System'),
    ipAddress: typeof raw['ipAddress'] === 'string' ? raw['ipAddress'] : null,
    timestamp: str(raw['timestamp']),
    changedFields: changedFields(raw),
  };
}

export interface AuditLogFilters {
  entityType?: string;
  entityId?: string;
  userId?: string;
  operation?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

export function listAuditLogs(filters: AuditLogFilters = {}) {
  return fetchPlatformList<AuditLogEntry>(
    `/audit-logs${toQuery({
      entityType: filters.entityType,
      entityId: filters.entityId,
      userId: filters.userId,
      operation: filters.operation,
      startDate: filters.startDate,
      endDate: filters.endDate,
      page: filters.page,
      pageSize: filters.pageSize,
      sortOrder: 'desc',
    })}`,
    mapAuditEntry,
  );
}

// ─── Audit integrity / retention / DSAR (G-913) ──────────────────────────

export interface PlatformItemResult<T> {
  data: T | null;
  source: ScaffoldDataSource;
  access: PlatformAccess;
  errorCode?: string;
}

async function fetchPlatformItem<T>(path: string): Promise<PlatformItemResult<T>> {
  const result = await gatewayFetch<T>(path, { throwOnError: false, next: { revalidate: 0 } });
  const source = scaffoldSourceFromResponse(result.ok, result.status);
  if (result.status === 403) {
    return { data: null, source, access: 'forbidden', errorCode: result.error?.code };
  }
  if (!result.ok) {
    return {
      data: null,
      source,
      access: 'ok',
      ...(result.error?.code ? { errorCode: result.error.code } : {}),
    };
  }
  return { data: result.data ?? null, source, access: 'ok' };
}

export interface AuditChainVerification {
  tenantId: string;
  valid: boolean;
  checkedEntries: number;
  legacyEntries: number;
  headHash: string | null;
  headSeq: number;
  brokenAt: {
    chainSeq: number;
    entryId: string;
    reason: string;
    expected: string | null;
    actual: string | null;
  } | null;
  verifiedAt: string;
}

/** `GET /audit-logs/chain/verify` — recomputes the tenant hash chain. */
export function verifyAuditChain() {
  return fetchPlatformItem<AuditChainVerification>('/audit-logs/chain/verify');
}

export interface AuditRetentionConfig {
  tenantId: string;
  retentionMonths: number;
  archivalEnabled: boolean;
  archivalDestination: string | null;
  lastArchivalAt: string | null;
}

/** `GET /audit-logs/retention` — 404 (no config yet) is folded into `data: null`. */
export function getAuditRetention() {
  return fetchPlatformItem<AuditRetentionConfig>('/audit-logs/retention');
}

export async function saveAuditRetention(input: {
  retentionMonths: number;
  archivalEnabled: boolean;
  archivalDestination: string | null;
}): Promise<AuditRetentionConfig> {
  const result = await gatewayFetch<AuditRetentionConfig>('/audit-logs/retention', {
    method: 'PUT',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from audit service');
  return result.data;
}

export async function runAuditArchival(): Promise<{ archivedCount: number; cutoffDate: string }> {
  const result = await gatewayFetch<{ archivedCount: number; cutoffDate: string }>(
    '/audit-logs/archival/execute',
    { method: 'POST' },
  );
  if (!result.data) throw new Error('Empty response from audit service');
  return result.data;
}

export interface DsarPackage {
  subjectId: string;
  tenantId: string;
  exportedAt: string;
  entryCount: number;
  truncated: boolean;
  entries: AuditLogEntry[];
}

/** `GET /audit-logs/dsar/:subjectId` — every entry where the subject is the entity or the actor. */
export async function exportDsarPackage(
  subjectId: string,
): Promise<PlatformItemResult<DsarPackage>> {
  const raw = await fetchPlatformItem<
    Omit<DsarPackage, 'entries'> & { entries: Record<string, unknown>[] }
  >(`/audit-logs/dsar/${encodeURIComponent(subjectId)}`);
  if (!raw.data) return { ...raw, data: null };
  return { ...raw, data: { ...raw.data, entries: raw.data.entries.map(mapAuditEntry) } };
}

// ─── Tenant lifecycle ────────────────────────────────────────────────────

/** Known values: provisioning | active | suspended | decommissioned. */
export type TenantLifecycleStatus = string;

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: TenantLifecycleStatus;
  plan: string;
  region: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  decommissionedAt: string | null;
  dataRetentionUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

function nullableStr(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function mapTenant(raw: Record<string, unknown>): TenantSummary {
  return {
    id: str(raw['id']),
    name: str(raw['name']),
    slug: str(raw['slug']),
    status: str(raw['status'], 'active'),
    plan: str(raw['plan'], '—'),
    region: str(raw['region'], '—'),
    suspendedAt: nullableStr(raw['suspendedAt']),
    suspendedReason: nullableStr(raw['suspendedReason']),
    decommissionedAt: nullableStr(raw['decommissionedAt']),
    dataRetentionUntil: nullableStr(raw['dataRetentionUntil']),
    createdAt: str(raw['createdAt']),
    updatedAt: str(raw['updatedAt']),
  };
}

export interface TenantFilters {
  status?: string;
  region?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export function listTenants(filters: TenantFilters = {}) {
  return fetchPlatformList<TenantSummary>(
    `/tenant-lifecycle${toQuery({
      status: filters.status,
      region: filters.region,
      search: filters.search,
      page: filters.page,
      pageSize: filters.pageSize,
    })}`,
    mapTenant,
  );
}
