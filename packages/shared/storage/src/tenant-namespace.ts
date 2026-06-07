/**
 * Tenant-aware object key namespacing utilities.
 * Enforces the convention: tenants/{tenantId}/{key}
 */

const TENANT_PREFIX = 'tenants';

/**
 * Build a tenant-namespaced object key.
 * Ensures all objects are stored under tenants/{tenantId}/ prefix.
 *
 * @param tenantId - The tenant identifier
 * @param key - The object key (relative path within tenant namespace)
 * @returns The full namespaced key
 * @throws Error if tenantId or key is empty
 */
export function buildTenantKey(tenantId: string, key: string): string {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('tenantId must not be empty');
  }
  if (!key || key.trim().length === 0) {
    throw new Error('key must not be empty');
  }

  // Normalize: remove leading slashes from key
  const normalizedKey = key.replace(/^\/+/, '');
  // Remove trailing slashes from tenantId
  const normalizedTenantId = tenantId.replace(/\/+$/, '').trim();

  return `${TENANT_PREFIX}/${normalizedTenantId}/${normalizedKey}`;
}

/**
 * Build a tenant-namespaced prefix for listing objects.
 *
 * @param tenantId - The tenant identifier
 * @param prefix - Optional sub-prefix within the tenant namespace
 * @returns The full namespaced prefix
 */
export function buildTenantPrefix(tenantId: string, prefix?: string): string {
  if (!tenantId || tenantId.trim().length === 0) {
    throw new Error('tenantId must not be empty');
  }

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
