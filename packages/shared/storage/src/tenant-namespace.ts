/**
 * Tenant-aware object key namespacing utilities.
 * Enforces the convention: tenants/{tenantId}/{key}
 *
 * W1-SEC-11: builders and accessors fail closed when tenant is missing or
 * keys are unscoped (not under tenants/{id}/).
 */

const TENANT_PREFIX = 'tenants';

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

export function isProductionEnv(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return (nodeEnv ?? '').toLowerCase() === 'production';
}

export function isUnscopedTenantNamespaceAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.ALLOW_UNSCOPED_TENANT_NAMESPACES?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/** Whether object key operations must reject unscoped keys. */
export function shouldRequireTenantScopedObjectKeys(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: boolean,
): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (isUnscopedTenantNamespaceAllowed(env)) return false;
  // Always enforce for builders; for raw key ops default to production fail-closed.
  return isProductionEnv(env.NODE_ENV);
}

export function assertTenantId(
  tenantId: string | null | undefined,
  surface = 'storage',
): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new TenantScopeError(
      `${surface}: tenantId is required for tenant-scoped namespaces (W1-SEC-11)`,
    );
  }
}

/** True when key is under tenants/{nonEmptyTenantId}/... */
export function isTenantScopedObjectKey(key: string): boolean {
  if (!key || key.trim().length === 0) return false;
  const parts = key.replace(/^\/+/, '').split('/');
  return parts.length >= 3 && parts[0] === TENANT_PREFIX && Boolean(parts[1]?.trim());
}

/**
 * Reject object keys / list prefixes that are not tenant-scoped.
 * Always enforced for write path builders; raw download/delete/list use this
 * when production fail-closed (or explicit require).
 */
export function assertTenantScopedObjectKey(key: string, surface = 'storage'): void {
  if (!isTenantScopedObjectKey(key)) {
    throw new TenantScopeError(
      `${surface}: unscoped object key/prefix rejected — expected tenants/{tenantId}/... (W1-SEC-11): "${key}"`,
    );
  }
}

/**
 * Optional production gate for raw key operations (download/delete/list/signed URL).
 */
export function assertTenantScopedObjectKeyIfRequired(
  key: string,
  options: { env?: NodeJS.ProcessEnv; requireTenantScope?: boolean; surface?: string } = {},
): void {
  const required = shouldRequireTenantScopedObjectKeys(options.env ?? process.env, options.requireTenantScope);
  if (required) {
    assertTenantScopedObjectKey(key, options.surface ?? 'storage');
  }
}

/**
 * Build a tenant-namespaced object key.
 * Ensures all objects are stored under tenants/{tenantId}/ prefix.
 *
 * @param tenantId - The tenant identifier
 * @param key - The object key (relative path within tenant namespace)
 * @returns The full namespaced key
 * @throws TenantScopeError if tenantId or key is empty
 */
export function buildTenantKey(tenantId: string, key: string): string {
  assertTenantId(tenantId, 'storage.buildTenantKey');
  if (!key || key.trim().length === 0) {
    throw new TenantScopeError('storage.buildTenantKey: key must not be empty');
  }

  // Normalize: remove leading slashes from key
  const normalizedKey = key.replace(/^\/+/, '');
  // Remove trailing slashes from tenantId
  const normalizedTenantId = tenantId.replace(/\/+$/, '').trim();

  const result = `${TENANT_PREFIX}/${normalizedTenantId}/${normalizedKey}`;
  assertTenantScopedObjectKey(result, 'storage.buildTenantKey');
  return result;
}

/**
 * Build a tenant-namespaced prefix for listing objects.
 *
 * @param tenantId - The tenant identifier
 * @param prefix - Optional sub-prefix within the tenant namespace
 * @returns The full namespaced prefix
 */
export function buildTenantPrefix(tenantId: string, prefix?: string): string {
  assertTenantId(tenantId, 'storage.buildTenantPrefix');

  const normalizedTenantId = tenantId.replace(/\/+$/, '').trim();
  const base = `${TENANT_PREFIX}/${normalizedTenantId}/`;

  if (!prefix || prefix.trim().length === 0) {
    return base;
  }

  const normalizedPrefix = prefix.replace(/^\/+/, '');
  return `${base}${normalizedPrefix}`;
}

/**
 * Extract the tenant ID from a namespaced key.
 *
 * @param namespacedKey - The full key (e.g., 'tenants/abc-123/documents/file.pdf')
 * @returns The tenant ID, or null if the key doesn't follow the convention
 */
export function extractTenantId(namespacedKey: string): string | null {
  const parts = namespacedKey.split('/');
  if (parts.length < 3 || parts[0] !== TENANT_PREFIX) {
    return null;
  }
  return parts[1] ?? null;
}

/**
 * Validate that a key belongs to the expected tenant.
 *
 * @param key - The full namespaced key
 * @param expectedTenantId - The tenant ID to validate against
 * @returns true if the key belongs to the expected tenant
 */
export function validateTenantOwnership(key: string, expectedTenantId: string): boolean {
  const tenantId = extractTenantId(key);
  return tenantId === expectedTenantId;
}
