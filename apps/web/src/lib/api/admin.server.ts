/**
 * Server-side admin API helpers (G-910).
 *
 * Talk to the tenant admin console mounted by the gateway at
 * `/api/v1/tenant/*` (roles, permissions, users, settings). These functions
 * use gatewayFetch (which depends on next/headers) and must only be imported
 * from Server Components or Server Actions — never from client components.
 */
import { gatewayFetch } from './gateway';
import type { ScaffoldDataSource } from './insights-source';

export type { ScaffoldDataSource };

/** How the gateway answered: live data, denied, or unreachable. */
export type AdminSource = ScaffoldDataSource | 'forbidden';

export interface PermissionRef {
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'list' | 'manage';
}

/** Role as served by `/tenant/roles`. */
export interface TenantRole {
  id: string;
  name: string;
  description: string | null;
  builtIn: boolean;
  permissions: PermissionRef[];
  createdAt: string;
  updatedAt: string;
}

/** Directory user as served by `/tenant/users`. */
export interface TenantUser {
  id: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  roleIds: string[];
}

export interface TenantSettings {
  tenantId: string;
  displayName: string;
  defaultLocale: string;
  supportedLocales: string[];
  timezone: string;
  academicYearStartMonth: number;
  branding: { primaryColor: string; accentColor: string; logoUrl?: string | null };
  contact: { email?: string | null; phone?: string | null };
  updatedAt: string;
  updatedBy: string | null;
}

function sourceOf(status: number, ok: boolean): AdminSource {
  if (ok) return 'gateway';
  return status === 403 ? 'forbidden' : 'scaffold';
}

export async function listTenantRoles(): Promise<{ roles: TenantRole[]; source: AdminSource }> {
  const result = await gatewayFetch<{ data: TenantRole[] }>('/tenant/roles', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return { roles: result.data?.data ?? [], source: sourceOf(result.status, result.ok) };
}

export async function listTenantUsers(
  params: {
    search?: string;
    status?: TenantUser['status'];
    roleId?: string;
  } = {},
): Promise<{ users: TenantUser[]; source: AdminSource }> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.status) qs.set('status', params.status);
  if (params.roleId) qs.set('roleId', params.roleId);
  qs.set('pageSize', '100');
  const result = await gatewayFetch<{ data: TenantUser[] }>(`/tenant/users?${qs.toString()}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return { users: result.data?.data ?? [], source: sourceOf(result.status, result.ok) };
}

export async function listPermissionCatalog(): Promise<{
  permissions: PermissionRef[];
  source: AdminSource;
}> {
  const result = await gatewayFetch<{ data: PermissionRef[] }>('/tenant/permissions', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return { permissions: result.data?.data ?? [], source: sourceOf(result.status, result.ok) };
}

export async function getTenantSettings(): Promise<{
  settings: TenantSettings | null;
  source: AdminSource;
}> {
  const result = await gatewayFetch<TenantSettings>('/tenant/settings', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return { settings: result.data, source: sourceOf(result.status, result.ok) };
}

export async function saveTenantSettings(
  input: Omit<TenantSettings, 'tenantId' | 'updatedAt' | 'updatedBy'>,
): Promise<TenantSettings> {
  const result = await gatewayFetch<TenantSettings>('/tenant/settings', {
    method: 'PUT',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from tenant service');
  return result.data;
}

export async function inviteTenantUser(input: {
  email: string;
  displayName: string;
  roleIds: string[];
}): Promise<TenantUser> {
  const result = await gatewayFetch<TenantUser>('/tenant/users', { method: 'POST', json: input });
  if (!result.data) throw new Error('Empty response from tenant service');
  return result.data;
}

export async function setTenantUserRoles(userId: string, roleIds: string[]): Promise<TenantUser> {
  const result = await gatewayFetch<TenantUser>(`/tenant/users/${userId}/roles`, {
    method: 'PATCH',
    json: { roleIds },
  });
  if (!result.data) throw new Error('Empty response from tenant service');
  return result.data;
}

export async function setTenantUserStatus(
  userId: string,
  status: 'ACTIVE' | 'SUSPENDED',
): Promise<TenantUser> {
  const result = await gatewayFetch<TenantUser>(`/tenant/users/${userId}/status`, {
    method: 'PATCH',
    json: { status },
  });
  if (!result.data) throw new Error('Empty response from tenant service');
  return result.data;
}

export async function createTenantRole(input: {
  name: string;
  description?: string | null;
  permissions: PermissionRef[];
}): Promise<TenantRole> {
  const result = await gatewayFetch<TenantRole>('/tenant/roles', { method: 'POST', json: input });
  if (!result.data) throw new Error('Empty response from tenant service');
  return result.data;
}

export async function updateTenantRole(
  id: string,
  input: { name?: string; description?: string | null; permissions?: PermissionRef[] },
): Promise<TenantRole> {
  const result = await gatewayFetch<TenantRole>(`/tenant/roles/${id}`, {
    method: 'PATCH',
    json: input,
  });
  if (!result.data) throw new Error('Empty response from tenant service');
  return result.data;
}

export async function deleteTenantRole(id: string): Promise<void> {
  await gatewayFetch(`/tenant/roles/${id}`, { method: 'DELETE' });
}
