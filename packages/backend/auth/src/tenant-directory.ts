/**
 * Tenant directory port for GET /auth/tenants (PRC-L084).
 *
 * Structural so the gateway can pass the tenant repository directly without a
 * package dependency from auth -> tenant.
 */
export interface TenantDirectoryReader {
  findTenantById(
    id: string,
  ): Promise<{ id: string; name: string; slug: string; status: string } | null>;
}

export type TenantDirectoryEntry = { id: string; name: string; slug: string; status: string };

/**
 * Resolve the signed-in user's tenant from the tenant repository.
 * Unknown tenants are omitted (never echoed back as "active"). Without a
 * reader, falls back to the legacy claim-only stub.
 */
export async function resolveTenantDirectory(
  tenantId: string | undefined,
  reader: TenantDirectoryReader | undefined,
): Promise<TenantDirectoryEntry[]> {
  if (!tenantId) return [];
  if (!reader) {
    return [{ id: tenantId, name: tenantId, slug: tenantId, status: 'active' }];
  }
  const tenant = await reader.findTenantById(tenantId);
  if (!tenant) return [];
  return [{ id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status }];
}
