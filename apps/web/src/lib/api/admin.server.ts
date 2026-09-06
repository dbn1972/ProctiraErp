/**
 * Server-side admin API helpers.
 *
 * These functions use gatewayFetch (which depends on next/headers) and must
 * only be imported from Server Components or Server Actions — never from
 * client components.
 */
import { gatewayFetch } from './gateway';
import type { AdminUser, Role, Permission, TenantConfig } from './admin';
import type { ScaffoldDataSource } from './insights-source';

export type { ScaffoldDataSource };

export async function listUsers(): Promise<{
  users: AdminUser[];
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<{ data: AdminUser[] }>('/admin/users', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { users: result.data?.data ?? [], source: 'gateway' };
  }
  return { users: [], source: 'scaffold' };
}

export async function listRoles(): Promise<{
  roles: Role[];
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<{ data: Role[] }>('/admin/roles', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { roles: result.data?.data ?? [], source: 'gateway' };
  }
  return { roles: [], source: 'scaffold' };
}

export async function listPermissions(): Promise<{
  permissions: Permission[];
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<{ data: Permission[] }>('/admin/permissions', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { permissions: result.data?.data ?? [], source: 'gateway' };
  }
  return { permissions: [], source: 'scaffold' };
}

export async function getTenantConfig(): Promise<{
  config: TenantConfig | null;
  source: ScaffoldDataSource;
}> {
  const result = await gatewayFetch<TenantConfig>('/admin/tenant', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  if (result.ok) {
    return { config: result.data, source: 'gateway' };
  }
  return { config: null, source: 'scaffold' };
}
