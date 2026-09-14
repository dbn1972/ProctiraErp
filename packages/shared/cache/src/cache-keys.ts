/**
 * @proctira/cache - Key builder helpers
 *
 * Provides consistent, tenant-scoped cache key generation
 * to avoid key collisions across tenants and entities.
 *
 * W1-SEC-11: builders fail closed when tenantId is missing/blank.
 */

import { assertTenantId } from './tenant-scope.js';

/**
 * Build a tenant-scoped entity key.
 * Format: `t:{tenantId}:{entity}:{id}`
 *
 * @example tenantKey('acme', 'student', '123') → 't:acme:student:123'
 */
export function tenantKey(tenantId: string, entity: string, id: string): string {
  assertTenantId(tenantId, 'cache.tenantKey');
  if (!entity?.trim() || !id?.trim()) {
    throw new Error('cache.tenantKey: entity and id must not be empty');
  }
  return `t:${tenantId.trim()}:${entity.trim()}:${id.trim()}`;
}

/**
 * Build a tenant-scoped configuration key.
 * Format: `cfg:{tenantId}:{configType}`
 *
 * @example configKey('acme', 'grading-scale') → 'cfg:acme:grading-scale'
 */
export function configKey(tenantId: string, configType: string): string {
  assertTenantId(tenantId, 'cache.configKey');
  if (!configType?.trim()) {
    throw new Error('cache.configKey: configType must not be empty');
  }
  return `cfg:${tenantId.trim()}:${configType.trim()}`;
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
  assertTenantId(tenantId, 'cache.listKey');
  if (!entity?.trim() || !hash?.trim()) {
    throw new Error('cache.listKey: entity and hash must not be empty');
  }
  return `lst:${tenantId.trim()}:${entity.trim()}:${hash.trim()}`;
}
