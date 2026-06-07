/**
 * @proctira/cache - Key builder helpers
 *
 * Provides consistent, tenant-scoped cache key generation
 * to avoid key collisions across tenants and entities.
 */

/**
 * Build a tenant-scoped entity key.
 * Format: `t:{tenantId}:{entity}:{id}`
 *
 * @example tenantKey('acme', 'student', '123') → 't:acme:student:123'
 */
export function tenantKey(tenantId: string, entity: string, id: string): string {
  return `t:${tenantId}:${entity}:${id}`;
}

/**
 * Build a tenant-scoped configuration key.
 * Format: `cfg:{tenantId}:{configType}`
 *
 * @example configKey('acme', 'grading-scale') → 'cfg:acme:grading-scale'
 */
export function configKey(tenantId: string, configType: string): string {
  return `cfg:${tenantId}:${configType}`;
}

/**
 * Build a tenant-scoped list/query key.
 * Format: `lst:{tenantId}:{entity}:{hash}`
 *
 * The hash should be a deterministic representation of the query params
 * (e.g., a sorted JSON hash) to ensure cache hits for identical queries.
 *
 * @example listKey('acme', 'students', 'abc123') → 'lst:acme:students:abc123'
 */
export function listKey(tenantId: string, entity: string, hash: string): string {
  return `lst:${tenantId}:${entity}:${hash}`;
}
