/**
 * W1-SEC-11 — Tenant-prefixed queue/topic naming for queue-abstraction.
 */

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeError';
  }
}

export function assertTenantId(
  tenantId: string | null | undefined,
  surface = 'queue',
): asserts tenantId is string {
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new TenantScopeError(
      `${surface}: tenantId is required for tenant-scoped namespaces (W1-SEC-11)`,
    );
  }
}

/** Format: tenant.{tenantId}.{suffix} with non-empty tenant segment. */
export function isTenantScopedQueueName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  return /^tenant\.[^.\s][^.]*\./.test(name);
}

export function assertTenantScopedQueueName(name: string, surface = 'queue'): void {
  if (!isTenantScopedQueueName(name)) {
    throw new TenantScopeError(
      `${surface}: unscoped name rejected — expected tenant.{tenantId}.{name} (W1-SEC-11): "${name}"`,
    );
  }
}
