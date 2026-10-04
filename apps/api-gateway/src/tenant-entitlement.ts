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
 * Mutating /api/v1 routes (except /auth and the remediation paths in app.ts) return 403
 * TENANT_SUSPENDED for a suspended or decommissioned tenant. Reads stay allowed (read-only while
 * suspended, G-106). A tenant the store cannot resolve (null) is treated as not blocked: some
 * tenants exist only outside the lifecycle store (PRC-H100 split-brain), so blocking unknown ids
 * would take them down.
 */

import { isProductionNodeEnv } from '@proctira/common/node-env';
export type GateTenantStatus = 'provisioning' | 'active' | 'suspended' | 'decommissioned';

/** Resolve a tenant's lifecycle status; null when the tenant store does not know the id. */
export type TenantStatusSource = (tenantId: string) => Promise<GateTenantStatus | null>;

const suspendedTenantIds = new Set<string>();
const DEFAULT_TTL_MS = 15_000;

let statusSource: TenantStatusSource | null = null;
let ttlMs = DEFAULT_TTL_MS;
const cache = new Map<string, { status: GateTenantStatus | null; expiresAt: number }>();
/** Bumped by noteTenantStatusChange so an in-flight store read cannot overwrite a newer event. */
const versions = new Map<string, number>();

function bootstrapFromEnv(): void {
  // Env-seeded suspension is a dev/test convenience only; production status comes from the store.
  if (isProductionNodeEnv(process.env['NODE_ENV'])) return;
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
  versions.set(tenantId, (versions.get(tenantId) ?? 0) + 1);
  cache.set(tenantId, { status, expiresAt: Date.now() + ttlMs });
}

/**
 * Drop this process's cached status so the next request re-reads the tenant store. Used for
 * cross-replica messages: they only say "this tenant changed", so a delayed or reordered message
 * can never overwrite a newer status with an older one.
 */
export function invalidateTenantStatus(tenantId: string): void {
  versions.set(tenantId, (versions.get(tenantId) ?? 0) + 1);
  cache.delete(tenantId);
}
/** The currently installed source (lets an app reset only its own wiring on close). */
export function currentTenantStatusSource(): TenantStatusSource | null {
  return statusSource;
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
  const versionAtStart = versions.get(tenantId) ?? 0;
  const status = await statusSource(tenantId);
  // A lifecycle event that landed while we were reading is newer than this read: keep it.
  if ((versions.get(tenantId) ?? 0) !== versionAtStart) {
    const newer = cache.get(tenantId);
    if (newer) return isBlockingStatus(newer.status);
    // Invalidated by a cross-replica message meanwhile: this read may be stale, read again.
    return resolveTenantBlocked(tenantId);
  }
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

/**
 * PRC-H008 / PRC-H098 — `TENANT_SUSPEND_BLOCK_AUTH` (default true, fail closed): a suspended or
 * decommissioned tenant is blocked entirely — login and refresh are refused, every authenticated
 * /api/v1 request is rejected and the tenant's sessions are revoked on suspension. Set it to
 * `false` for the read-only-while-suspended mode (writes blocked, reads and remediation allowed).
 */
export function tenantSuspendBlocksAuth(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env['TENANT_SUSPEND_BLOCK_AUTH'] ?? '').trim().toLowerCase();
  return !['false', '0', 'off', 'no'].includes(raw);
}

export function isBlockingTenantStatus(status: string | null | undefined): boolean {
  return status === 'suspended' || status === 'decommissioned';
}

const GATE_STATUSES: ReadonlySet<string> = new Set([
  'provisioning',
  'active',
  'suspended',
  'decommissioned',
]);
export const TENANT_STATUS_CHANNEL = 'proctira:tenant-status';

/** Minimal ioredis surface for the cross-replica tenant-status bus. */
export interface RedisTenantStatusSubscriber {
  /** ioredis connection state; 'wait' means a lazyConnect client not yet connected. */
  readonly status?: string;
  connect?(): Promise<void>;
  subscribe(channel: string): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  quit(): Promise<unknown>;
}
export interface RedisTenantStatusPublisher {
  publish(channel: string, message: string): Promise<number>;
  duplicate(): RedisTenantStatusSubscriber;
}
export interface TenantStatusBus {
  publish(tenantId: string, status: GateTenantStatus): Promise<void>;
  close(): Promise<void>;
}

/** Apply a remote status message (invalidate this process's cache); ignores malformed payloads. */
export function applyTenantStatusMessage(message: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return false;
  }
  const { tenantId, status } = (parsed ?? {}) as { tenantId?: unknown; status?: unknown };
  if (typeof tenantId !== 'string' || !tenantId || typeof status !== 'string') return false;
  if (!GATE_STATUSES.has(status)) return false;
  invalidateTenantStatus(tenantId);
  return true;
}

/**
 * PRC-H008: Redis pub/sub invalidation so every gateway replica enforces a lifecycle transition
 * immediately instead of waiting for its status-cache TTL. The TTL read from the tenant store
 * stays the backstop when a message is missed.
 */
export async function startRedisTenantStatusBus(
  redis: RedisTenantStatusPublisher,
  log: { warn: (obj: object, msg: string) => void } = { warn: () => undefined },
): Promise<TenantStatusBus> {
  const subscriber = redis.duplicate();
  // The gateway's client is lazyConnect with no offline queue, so its duplicate must connect first.
  if (subscriber.connect && subscriber.status === 'wait') await subscriber.connect();
  subscriber.on('message', (channel, message) => {
    if (channel !== TENANT_STATUS_CHANNEL) return;
    if (!applyTenantStatusMessage(message)) {
      log.warn({ channel }, 'ignored malformed tenant-status message');
    }
  });
  await subscriber.subscribe(TENANT_STATUS_CHANNEL);
  return {
    async publish(tenantId, status) {
      await redis.publish(TENANT_STATUS_CHANNEL, JSON.stringify({ tenantId, status }));
    },
    async close() {
      await subscriber.quit();
    },
  };
}

/** Test helper: mark a tenant as suspended. */
export function suspendTenantForTests(tenantId: string): void {
  suspendedTenantIds.add(tenantId);
}

/** Test helper: clear all suspended tenants (and re-bootstrap from env). */
export function clearSuspendedTenantsForTests(): void {
  suspendedTenantIds.clear();
  cache.clear();
  versions.clear();
  bootstrapFromEnv();
}
