/**
 * Server-side admin API helpers.
 *
 * These functions use gatewayFetch (which depends on next/headers) and must
 * only be imported from Server Components or Server Actions — never from
 * client components.
 */
import { gatewayFetch } from './gateway';
import type { AdminUser, Role, Permission, TenantConfig } from './admin';

export async function listUsers(): Promise<AdminUser[]> {
  const result = await gatewayFetch<{ data: AdminUser[] }>('/admin/users', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listRoles(): Promise<Role[]> {
  const result = await gatewayFetch<{ data: Role[] }>('/admin/roles', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function listPermissions(): Promise<Permission[]> {
  const result = await gatewayFetch<{ data: Permission[] }>('/admin/permissions', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function getTenantConfig(): Promise<TenantConfig | null> {
  const result = await gatewayFetch<TenantConfig>('/admin/tenant', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data;
}
