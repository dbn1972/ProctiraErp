/**
 * G-106 — Tenant lifecycle / entitlement gate.
 *
 * PRC-H008 / PRC-H098: suspension used to live only in a process-local Set bootstrapped from
 * TENANT_SUSPENDED_IDS (plus a JWT claim nothing issues), so suspending a tenant through the
 * tenant lifecycle never reached this gate. The gate now resolves status from the tenant store
 * (configureTenantStatusSource) with a short TTL cache, and lifecycle transitions invalidate the
 * cache immediately in this process (noteTenantStatusChange). Other gateway instances converge
 * within the TTL.
 *
 * Mutating /api/v1 routes (except /auth) return 403 TENANT_SUSPENDED for a suspended or
 * decommissioned tenant. Reads stay allowed (read-only while suspended, G-106).
 */
export type GateTenantStatus = 'provisioning' | 'active' | 'suspended' | 'decommissioned';

/** Resolve a tenant's lifecycle status; null when the tenant store does not know the id. */
export type TenantStatusSource = (tenantId: string) => Promise<GateTenantStatus | null>;

const suspendedTenantIds = new Set<string>();
const DEFAULT_TTL_MS = 15_000;

let statusSource: TenantStatusSource | null = null;
let ttlMs = DEFAULT_TTL_MS;
const cache = new Map<string, { status: GateTenantStatus | null; expiresAt: number }>();

function bootstrapFromEnv(): void {
  // Env-seeded suspension is a dev/test convenience only; production status comes from the store.
  if ((process.env['NODE_ENV'] ?? '').toLowerCase() === 'production') return;
  const raw = process.env['TENANT_SUSPENDED_IDS'];
  if (!raw) return;
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id) suspendedTenantIds.add(id);
  }
}
bootstrapFromEnv();

/** Wire the gate to the tenant store (called once at gateway boot). */
export function configureTenantStatusSource(
  source: TenantStatusSource | null,
  options: { ttlMs?: number } = {},
): void {
  statusSource = source;
  ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  cache.clear();
}

/** Lifecycle hook: record a status change so this process enforces it immediately. */
export function noteTenantStatusChange(tenantId: string, status: GateTenantStatus): void {
  cache.set(tenantId, { status, expiresAt: Date.now() + ttlMs });
}

function isBlockingStatus(status: GateTenantStatus | null | undefined): boolean {
  return status === 'suspended' || status === 'decommissioned';
}

export function isTenantSuspended(tenantId: string): boolean {
  if (suspendedTenantIds.has(tenantId)) return true;
  const hit = cache.get(tenantId);
  return !!hit && hit.expiresAt > Date.now() && isBlockingStatus(hit.status);
}

/**
 * Resolve the tenant's status from the store (cached). Throws when the store lookup fails so
 * callers can fail closed for mutating requests.
 */
export async function resolveTenantBlocked(tenantId: string): Promise<boolean> {
  if (suspendedTenantIds.has(tenantId)) return true;
  if (!statusSource) return false;
  const hit = cache.get(tenantId);
  if (hit && hit.expiresAt > Date.now()) return isBlockingStatus(hit.status);
  const status = await statusSource(tenantId);
  cache.set(tenantId, { status, expiresAt: Date.now() + ttlMs });
  return isBlockingStatus(status);
}

/**
 * Resolve suspension from in-memory store and/or JWT claim (synchronous fast path).
 */
export function isRequestTenantSuspended(
  tenantId: string | undefined,
  user?: { tenantStatus?: string } | null,
): boolean {
  if (user?.tenantStatus === 'suspended') return true;
  if (tenantId && isTenantSuspended(tenantId)) return true;
  return false;
}

/** Test helper: mark a tenant as suspended. */
export function suspendTenantForTests(tenantId: string): void {
  suspendedTenantIds.add(tenantId);
}

/** Test helper: clear all suspended tenants (and re-bootstrap from env). */
export function clearSuspendedTenantsForTests(): void {
  suspendedTenantIds.clear();
  cache.clear();
  bootstrapFromEnv();
}
