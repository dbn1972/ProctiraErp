/**
 * W1-SEC-11 — Tenant scope enforcement for cache keys.
 *
 * Cache isolation must not rely on caller convention alone: builders reject
 * missing tenants, and production CacheClient rejects unscoped keys.
 */

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

export function isProductionEnv(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return (nodeEnv ?? '').toLowerCase() === 'production';
}

/**
 * Emergency escape hatch — must never be set in normal production.
 * When set, CacheClient will not reject unscoped keys even in production.
 */
export function isUnscopedTenantNamespaceAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.ALLOW_UNSCOPED_TENANT_NAMESPACES?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Non-empty trimmed tenant id or throw. */
export function assertTenantId(
  tenantId: string | null | undefined,
  surface = 'cache',
): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new TenantScopeError(
      `${surface}: tenantId is required for tenant-scoped namespaces (W1-SEC-11)`,
    );
  }
}

/**
 * Known tenant-scoped cache key shapes:
 * - `t:{tenantId}:{entity}:{id}` (tenantKey)
 * - `cfg:{tenantId}:{configType}` (configKey)
 * - `lst:{tenantId}:{entity}:{hash}` (listKey)
 * - `tenant:{tenantId}:{...}` (isolation-test / alternate convention)
 */
export function isTenantScopedCacheKey(key: string): boolean {
  if (!key || key.trim().length === 0) return false;
  // Reject empty tenant segments: t::entity:id, cfg::x, tenant::x
  return /^(?:t|cfg|lst|tenant):[^:\s][^:]*:/.test(key);
}

/**
 * Reject keys that are not tenant-scoped.
 * Always throws for empty/invalid keys; used by builders and CacheClient.
 */
export function assertTenantScopedCacheKey(key: string, surface = 'cache'): void {
  if (!isTenantScopedCacheKey(key)) {
    throw new TenantScopeError(
      `${surface}: unscoped cache key rejected — expected t:|cfg:|lst:|tenant: prefix with tenant id (W1-SEC-11): "${key}"`,
    );
  }
}

/**
 * Whether CacheClient must reject unscoped keys (fail closed in production).
 */
export function shouldRequireTenantScopedCacheKeys(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: boolean,
): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (isUnscopedTenantNamespaceAllowed(env)) return false;
  return isProductionEnv(env.NODE_ENV);
}
