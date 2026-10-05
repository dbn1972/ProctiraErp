/**
 * PRC-H008 / PRC-H098 — tenant-wide session revocation.
 *
 * Suspending (or decommissioning) a tenant records a per-tenant "sessions revoked at" epoch.
 * Every access or refresh token for that tenant issued at or before the epoch is rejected, so
 * sessions opened before the suspension stay dead even after the tenant is reactivated; users
 * sign in again. Production must use the shared Redis store so every replica sees the epoch.
 *
 * Implementations MUST throw when their backend is unavailable so callers can fail closed.
 */
export interface TenantSessionRevocationStore {
  readonly shared?: boolean;
  /** Revoke every session of `tenantId` issued at or before `revokedAtSeconds`. */
  revokeTenantSessions(
    tenantId: string,
    revokedAtSeconds: number,
    ttlSeconds: number,
  ): Promise<void>;
  /** Epoch (seconds) of the latest tenant-wide revocation, or null when none is active. */
  tenantSessionsRevokedAt(tenantId: string): Promise<number | null>;
}

/** Default marker lifetime: the refresh-token maximum lifetime (30 days). */
export const DEFAULT_TENANT_SESSION_REVOCATION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** True when a token issued at `issuedAtSeconds` predates the tenant-wide revocation. */
export function isIssuedBeforeTenantRevocation(
  issuedAtSeconds: number | undefined,
  revokedAtSeconds: number | null,
): boolean {
  if (revokedAtSeconds === null) return false;
  // A token without iat cannot prove it was issued after the revocation: reject it.
  if (typeof issuedAtSeconds !== 'number' || !Number.isFinite(issuedAtSeconds)) return true;
  return issuedAtSeconds <= revokedAtSeconds;
}

/** Process-local store for tests and single-process non-production use only. */
export class MemoryTenantSessionRevocationStore implements TenantSessionRevocationStore {
  readonly shared = false;
  private readonly entries = new Map<string, { revokedAt: number; expiresAt: number }>();

  revokeTenantSessions(
    tenantId: string,
    revokedAtSeconds: number,
    ttlSeconds: number,
  ): Promise<void> {
    const previous = this.entries.get(tenantId);
    const revokedAt = Math.max(Math.trunc(revokedAtSeconds), previous?.revokedAt ?? 0);
    this.entries.set(tenantId, {
      revokedAt,
      expiresAt: Date.now() + Math.max(1, Math.trunc(ttlSeconds)) * 1000,
    });
    return Promise.resolve();
  }

  tenantSessionsRevokedAt(tenantId: string): Promise<number | null> {
    const hit = this.entries.get(tenantId);
    if (!hit) return Promise.resolve(null);
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(tenantId);
      return Promise.resolve(null);
    }
    return Promise.resolve(hit.revokedAt);
  }

  /** Test helper. */
  clear(): void {
    this.entries.clear();
  }
}

/** Minimal Redis client surface (ioredis-compatible). */
export interface RedisLikeForTenantSessionRevocation {
  set(key: string, value: string, expiryMode: 'EX', ttlSeconds: number): Promise<string | null>;
  get(key: string): Promise<string | null>;
}

/** Redis-backed tenant revocation epoch (`SET key <epoch> EX ttl`), shared across replicas. */
export class RedisTenantSessionRevocationStore implements TenantSessionRevocationStore {
  readonly shared = true;

  constructor(
    private readonly redis: RedisLikeForTenantSessionRevocation,
    private readonly keyPrefix = 'auth:tenant-revoke:',
  ) {}

  async revokeTenantSessions(
    tenantId: string,
    revokedAtSeconds: number,
    ttlSeconds: number,
  ): Promise<void> {
    const key = `${this.keyPrefix}${tenantId}`;
    const previous = Number(await this.redis.get(key));
    const revokedAt = Math.max(
      Math.trunc(revokedAtSeconds),
      Number.isFinite(previous) ? previous : 0,
    );
    await this.redis.set(key, String(revokedAt), 'EX', Math.max(1, Math.trunc(ttlSeconds)));
  }

  async tenantSessionsRevokedAt(tenantId: string): Promise<number | null> {
    const raw = await this.redis.get(`${this.keyPrefix}${tenantId}`);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }
}

/**
 * Shared Redis store when a client is available; process-local memory otherwise. Production
 * without Redis refuses to start (same contract as the access-token denylist, W1-SEC-09).
 */
export function createTenantSessionRevocationStore(
  env: { redis?: RedisLikeForTenantSessionRevocation; NODE_ENV?: string } = {},
): TenantSessionRevocationStore {
  if (env.redis) return new RedisTenantSessionRevocationStore(env.redis);
  const nodeEnv = (env.NODE_ENV ?? process.env['NODE_ENV'] ?? '').toLowerCase();
  if (nodeEnv === 'production') {
    throw new Error(
      'Shared tenant session revocation store (REDIS_URL / redis) is required in production (PRC-H008).',
    );
  }
  return new MemoryTenantSessionRevocationStore();
}
