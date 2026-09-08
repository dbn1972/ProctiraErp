/**
 * G-106 — Tenant lifecycle / entitlement gate.
 *
 * Tracks suspended tenant IDs in-memory (bootstrap via TENANT_SUSPENDED_IDS).
 * Mutating /api/v1 routes (except /auth) return 403 TENANT_SUSPENDED when the
 * resolved request.tenantId is in the set.
 */

const suspendedTenantIds = new Set<string>();

function bootstrapFromEnv(): void {
  const raw = process.env['TENANT_SUSPENDED_IDS'];
  if (!raw) return;
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id) suspendedTenantIds.add(id);
  }
}

bootstrapFromEnv();

export function isTenantSuspended(tenantId: string): boolean {
  return suspendedTenantIds.has(tenantId);
}

/** Test helper: mark a tenant as suspended. */
export function suspendTenantForTests(tenantId: string): void {
  suspendedTenantIds.add(tenantId);
}

/** Test helper: clear all suspended tenants (and re-bootstrap from env). */
export function clearSuspendedTenantsForTests(): void {
  suspendedTenantIds.clear();
  bootstrapFromEnv();
}
