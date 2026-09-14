/**
 * W1-SEC-11 — Tenant-prefixed topic/queue/routing-key builders for events.
 */

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

export function assertTenantId(
  tenantId: string | null | undefined,
  surface = 'events',
): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new TenantScopeError(
      `${surface}: tenantId is required for tenant-scoped namespaces (W1-SEC-11)`,
    );
  }
}

/** Format: tenant.{tenantId}.{suffix} with non-empty tenant segment. */
export function isTenantScopedEventName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  return /^tenant\.[^.\s][^.]*\./.test(name);
}

export function assertTenantScopedEventName(name: string, surface = 'events'): void {
  if (!isTenantScopedEventName(name)) {
    throw new TenantScopeError(
      `${surface}: unscoped name rejected — expected tenant.{tenantId}.{name} (W1-SEC-11): "${name}"`,
    );
  }
}

/**
 * Builds a tenant-prefixed name: tenant.{tenantId}.{suffix}
 * Fails closed when tenantId is missing/blank.
 */
export function buildTenantPrefixedName(
  tenantId: string,
  suffix: string,
  surface = 'events',
): string {
  assertTenantId(tenantId, surface);
  if (!suffix || suffix.trim().length === 0) {
    throw new TenantScopeError(`${surface}: name/suffix must not be empty`);
  }
  const normalizedTenant = tenantId.trim();
  const normalizedSuffix = suffix.trim();
  const result = `tenant.${normalizedTenant}.${normalizedSuffix}`;
  assertTenantScopedEventName(result, surface);
  return result;
}
