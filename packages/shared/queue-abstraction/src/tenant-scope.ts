/**
 * W1-SEC-11 — Tenant-prefixed queue/topic naming for queue-abstraction.
 *
 * Publishers use {@link buildTenantName}; subscribe/consume paths must also
 * reject unscoped caller topics (not convention-only).
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
 * When set, subscribe/consume will not reject unscoped topics.
 */
export function isUnscopedTenantNamespaceAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.ALLOW_UNSCOPED_TENANT_NAMESPACES?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
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

/**
 * Format: `tenant.{tenantId|*} .{suffix...}` or platform pattern `tenant.#`.
 * Rejects bare topics (`events`), empty tenant segments (`tenant..x`), and
 * fully unscoped wildcards (`#`, `*`).
 */
export function isTenantScopedQueueName(name: string): boolean {
  if (!name || name.trim().length === 0) return false;
  const parts = name.split('.');
  if (parts[0] !== 'tenant') return false;
  const tenantSeg = parts[1];
  if (!tenantSeg || tenantSeg.trim().length === 0) return false;
  // `tenant.#` — all tenants (platform worker); still namespaced under tenant.
  if (parts.length === 2) return tenantSeg === '#';
  // `tenant.<id|*>.<rest...>`
  return true;
}

export function assertTenantScopedQueueName(name: string, surface = 'queue'): void {
  if (!isTenantScopedQueueName(name)) {
    throw new TenantScopeError(
      `${surface}: unscoped name rejected — expected tenant.{tenantId}.{name} (W1-SEC-11): "${name}"`,
    );
  }
}

/**
 * Whether subscribe/consume must reject unscoped topics.
 * Defaults to fail-closed always (builders style) unless emergency hatch;
 * production always requires unless hatch is set.
 */
export function shouldRequireTenantScopedQueueTopics(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: boolean,
): boolean {
  if (typeof explicit === 'boolean') return explicit;
  if (isUnscopedTenantNamespaceAllowed(env)) return false;
  // Always enforce for subscribe (residual from PARTIAL): missing scope fails closed.
  // Production is the compliance bar; non-prod also rejects unless hatch is set.
  void isProductionEnv(env.NODE_ENV);
  return true;
}

/**
 * Gate for adapter subscribe/consume — rejects unscoped caller topics.
 */
export function assertTenantScopedSubscribeTopic(
  topic: string,
  options: { env?: NodeJS.ProcessEnv; requireTenantScope?: boolean; surface?: string } = {},
): void {
  const required = shouldRequireTenantScopedQueueTopics(
    options.env ?? process.env,
    options.requireTenantScope,
  );
  if (required) {
    assertTenantScopedQueueName(topic, options.surface ?? 'queue.subscribe');
  }
}
