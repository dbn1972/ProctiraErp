/**
 * W1-SEC-11 — Tenant-prefixed topic/queue/routing-key builders for events.
 *
 * Builders fail closed on missing tenant; assert helpers reject unscoped names
 * (including bare wildcards). Kafka/RabbitMQ pub/sub paths use these builders.
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

export function isUnscopedTenantNamespaceAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.ALLOW_UNSCOPED_TENANT_NAMESPACES?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
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

/**
 * Format: `tenant.{tenantId|*} .{suffix...}` or platform pattern `tenant.#`.
 */
export function isTenantScopedEventName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  const parts = name.split('.');
  if (parts[0] !== 'tenant') return false;
  const tenantSeg = parts[1];
  if (!tenantSeg || tenantSeg.trim().length === 0) return false;
  if (parts.length === 2) return tenantSeg === '#';
  return true;
}

export function assertTenantScopedEventName(name: string, surface = 'events'): void {
  if (!isTenantScopedEventName(name)) {
    throw new TenantScopeError(
      `${surface}: unscoped name rejected — expected tenant.{tenantId}.{name} (W1-SEC-11): "${name}"`,
    );
  }
}

/**
 * Whether event topic/queue operations must reject unscoped names.
 * Defaults to fail-closed unless emergency hatch is set.
 */
export function shouldRequireTenantScopedEventNames(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: boolean,
): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (isUnscopedTenantNamespaceAllowed(env)) return false;
  void isProductionEnv(env.NODE_ENV);
  return true;
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
