/**
 * Admin service client (users, roles, permissions, tenant config).
 *
 * Validates: Requirement 4.x — tenant administration; cross-cutting role
 * and permission management used by all modules. Task 59.3 — Settings →
 * Roles & Permissions wires this client into the matrix UI.
 *
 * The module exposes two stripes of helpers:
 *
 *   • Server-side helpers live in `./admin.server.ts` (G-910) and talk to the
 *     gateway `/tenant/*` admin console via `gatewayFetch`; import them only
 *     from Server Components / Server Actions.
 *
 *   • Client-side helpers used by the federated React Router shell
 *     (`apps/web/src/RootRouter.tsx`). These talk to the gateway directly
 *     using `fetch` and are the surface the Roles & Permissions page
 *     consumes. The high-risk audit trail for every role/user mutation is
 *     written SERVER-SIDE, in the same database transaction as the mutation
 *     (PRC-L264); the browser no longer emits a (client-trusted) audit event.
 */

// ────────────────────────────────────────────────────────────────────────
// Server-side helpers (existing — kept for SC / Server Actions)
// NOTE: Server-side functions that use gatewayFetch have been moved to
// ./admin.server.ts to avoid pulling next/headers into client bundles.
// ────────────────────────────────────────────────────────────────────────

import { CSRF_HEADER, readCsrfTokenFromDocument } from '@/lib/auth/csrf';
import { BROWSER_GATEWAY_API_PREFIX, BROWSER_GATEWAY_BASE_URL } from './browser-gateway';
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  roles: string[];
  lastLoginAt?: string | null;
}

export interface Role {
  id: string;
  name: string;
  description?: string;
  permissionCount: number;
  isSystem: boolean;
}

export interface Permission {
  id: string;
  module: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'approve';
  description: string;
  rolesAssigned: number;
}

export interface TenantConfig {
  tenantId: string;
  displayName: string;
  defaultLocale: string;
  supportedLocales: string[];
  branding: {
    primaryColor: string;
    accentColor: string;
    logoUrl?: string | null;
  };
  contact: {
    email?: string | null;
    phone?: string | null;
  };
}

// ────────────────────────────────────────────────────────────────────────
// Client-side Roles & Permissions surface (Task 59.3)
// ────────────────────────────────────────────────────────────────────────

/** Stable API endpoint paths consumed by the client. */
export const ADMIN_API_ENDPOINTS = {
  ROLES: '/api/v1/tenant/roles',
  PERMISSIONS: '/api/v1/tenant/permissions',
  USERS: '/api/v1/tenant/users',
  /**
   * Tenant general settings endpoint (Task 59.1 — Settings → General).
   *
   * The gateway maps this onto the Tenant Service's config endpoint
   * (`PUT /tenants/:id/config` from task 40.1) so the page does not need to
   * know the tenant id — it is resolved server-side from the JWT/session.
   * The handler accepts a partial payload and returns the merged settings
   * snapshot.
   */
  TENANT_SETTINGS: '/api/v1/tenant/settings',
} as const;

/** Permission entry mirrored from the policy registry (task 39.1). */
export interface RolePermission {
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'list' | 'manage';
}

/** Tenant-scoped role record returned by the backend. */
export interface TenantRole {
  id: string;
  name: string;
  description: string | null;
  builtIn: boolean;
  permissions: RolePermission[];
  createdAt: string;
  updatedAt: string;
}

/** User record surfaced on the role-to-user assignment grid. */
export interface TenantUser {
  id: string;
  email: string;
  displayName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  roleIds: string[];
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export interface ListUsersOptions {
  search?: string;
  roleId?: string;
  status?: TenantUser['status'];
  page?: number;
  pageSize?: number;
}

/** Configuration shared by every admin client helper. */
export interface AdminClientOptions {
  /** Override the global `fetch` (used by tests). */
  fetcher?: typeof fetch;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
}

// ─── Internal helpers ────────────────────────────────────────────────────

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(init: { status: number; code: string; message: string; details?: unknown }) {
    super(init.message);
    this.name = 'AdminApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
  }
}

export { AdminApiError };

/**
 * PRC-M486: the admin endpoints live on the API gateway (there is no
 * same-origin Next route for /api/v1/tenant/roles|users|settings), so
 * relative `/api/v1/...` paths are resolved against the browser gateway base
 * URL exactly like `browserGatewayFetch` does. Absolute URLs pass through.
 */
function resolveAdminUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith(BROWSER_GATEWAY_API_PREFIX + '/')) return `${BROWSER_GATEWAY_BASE_URL}${url}`;
  return url;
}
async function adminFetch<T>(
  url: string,
  init: RequestInit = {},
  options: AdminClientOptions = {},
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const headers = new Headers(init.headers);
  // PRC-M486: every request carries the double-submit CSRF token so the
  // gateway/middleware CSRF gate accepts mutations from this client.
  const csrfToken = readCsrfTokenFromDocument();
  if (csrfToken && !headers.has(CSRF_HEADER)) headers.set(CSRF_HEADER, csrfToken);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');

  const requestInit: RequestInit = {
    credentials: 'include',
    cache: 'no-store',
    ...init,
    headers,
  };
  if (options.signal) requestInit.signal = options.signal;

  const response = await fetcher(url, requestInit);

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  const payload = await readJson<unknown>(response);
  if (!response.ok) {
    const code = (payload as { code?: string } | null)?.code ?? 'GATEWAY_ERROR';
    const message =
      (payload as { message?: string } | null)?.message ?? response.statusText ?? 'Request failed';
    throw new AdminApiError({
      status: response.status,
      code,
      message,
      details: payload,
    });
  }

  return (payload as T) ?? (undefined as unknown as T);
}

// ─── Roles ────────────────────────────────────────────────────────────────

export async function listTenantRoles(options: AdminClientOptions = {}): Promise<TenantRole[]> {
  const result = await adminFetch<{ data: TenantRole[] }>(
    ADMIN_API_ENDPOINTS.ROLES,
    { method: 'GET' },
    options,
  );
  return result?.data ?? [];
}

export async function listPermissionCatalog(
  options: AdminClientOptions = {},
): Promise<RolePermission[]> {
  const result = await adminFetch<{ data: RolePermission[] }>(
    ADMIN_API_ENDPOINTS.PERMISSIONS,
    { method: 'GET' },
    options,
  );
  return result?.data ?? [];
}

export interface CreateRolePayload {
  name: string;
  description?: string | null;
  permissions: RolePermission[];
}

export async function createRole(
  payload: CreateRolePayload,
  options: AdminClientOptions = {},
): Promise<TenantRole> {
  // PRC-L264: the high-risk role audit row is written server-side, in the same
  // transaction as the mutation (tenant-admin plugin). No browser-emitted audit.
  return adminFetch<TenantRole>(
    ADMIN_API_ENDPOINTS.ROLES,
    { method: 'POST', body: JSON.stringify(payload) },
    options,
  );
}

export interface UpdateRolePermissionsPayload {
  permissions: RolePermission[];
}

export async function updateRolePermissions(
  roleId: string,
  payload: UpdateRolePermissionsPayload,
  _context: { roleName: string; previousPermissions: RolePermission[] },
  options: AdminClientOptions = {},
): Promise<TenantRole> {
  // PRC-L264: audit is written server-side in the mutation transaction.
  // `_context` is retained for call-site compatibility (before/after is now
  // captured server-side, not sent by the browser).
  return adminFetch<TenantRole>(
    `${ADMIN_API_ENDPOINTS.ROLES}/${encodeURIComponent(roleId)}/permissions`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    options,
  );
}

export async function deleteRole(
  roleId: string,
  _context: { roleName: string },
  options: AdminClientOptions = {},
): Promise<void> {
  // PRC-L264: audit is written server-side in the mutation transaction.
  await adminFetch<void>(
    `${ADMIN_API_ENDPOINTS.ROLES}/${encodeURIComponent(roleId)}`,
    { method: 'DELETE' },
    options,
  );
}

// ─── Users / Assignments ─────────────────────────────────────────────────

export async function listTenantUsers(
  filters: ListUsersOptions = {},
  options: AdminClientOptions = {},
): Promise<PaginatedResponse<TenantUser>> {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.roleId) params.set('roleId', filters.roleId);
  if (filters.status) params.set('status', filters.status);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));

  const url = params.size
    ? `${ADMIN_API_ENDPOINTS.USERS}?${params.toString()}`
    : ADMIN_API_ENDPOINTS.USERS;

  const result = await adminFetch<PaginatedResponse<TenantUser>>(url, { method: 'GET' }, options);
  return (
    result ?? {
      data: [],
      meta: {
        page: filters.page ?? 1,
        pageSize: filters.pageSize ?? 20,
        totalItems: 0,
        totalPages: 1,
      },
    }
  );
}

export async function assignRolesToUser(
  userId: string,
  roleIds: string[],
  _context: { userDisplayName: string; previousRoleIds: string[] },
  options: AdminClientOptions = {},
): Promise<TenantUser> {
  // PRC-L264: audit is written server-side in the mutation transaction.
  return adminFetch<TenantUser>(
    `${ADMIN_API_ENDPOINTS.USERS}/${encodeURIComponent(userId)}/roles`,
    { method: 'PATCH', body: JSON.stringify({ roleIds }) },
    options,
  );
}

// ─── Matrix helpers (pure — used by UI and tests) ────────────────────────

/** Stable string key used to identify a permission cell in the matrix. */
export function permissionKey(permission: RolePermission): string {
  return `${permission.resource}::${permission.action}`;
}

/**
 * Returns true when `role` already grants `permission` either directly or
 * via a wildcard / `manage` action (which subsumes every action on its
 * resource).
 *
 * Mirrors the evaluation logic in `RbacPermissionRegistry.roleHasPermission`
 * so the matrix UI shows the same "granted" state the backend would compute.
 */
export function roleHasPermission(
  role: Pick<TenantRole, 'permissions'>,
  permission: RolePermission,
): boolean {
  return role.permissions.some(
    (p) =>
      (p.resource === permission.resource || p.resource === '*') &&
      (p.action === permission.action || p.action === 'manage'),
  );
}

/**
 * Toggle a permission cell on or off. Returns the new permission list for
 * the role with the change applied. The function never mutates its input.
 *
 * - When the permission is currently granted via an exact `(resource, action)`
 *   entry, the entry is removed.
 * - When the permission is granted only by a wildcard or `manage` shortcut,
 *   toggling-off is rejected (returns the original list unchanged) — the UI
 *   surfaces this as a disabled checkbox so users edit the wildcard rule
 *   directly.
 * - When the permission is not granted, an exact entry is appended.
 */
export function togglePermission(
  permissions: RolePermission[],
  permission: RolePermission,
): RolePermission[] {
  const exactIndex = permissions.findIndex(
    (p) => p.resource === permission.resource && p.action === permission.action,
  );

  if (exactIndex >= 0) {
    return [...permissions.slice(0, exactIndex), ...permissions.slice(exactIndex + 1)];
  }

  // Granted only via wildcard/manage — refuse to add a redundant explicit
  // grant. The UI disables these cells, but the helper itself is the
  // canonical guard so test coverage doesn't depend on UI state.
  const grantedViaWildcard = permissions.some(
    (p) =>
      (p.resource === permission.resource || p.resource === '*') &&
      (p.action === permission.action || p.action === 'manage') &&
      !(p.resource === permission.resource && p.action === permission.action),
  );
  if (grantedViaWildcard) {
    return permissions;
  }

  return [...permissions, { ...permission }];
}

// ─── Tenant general settings (Task 59.1) ─────────────────────────────────

/**
 * Tenant-wide general settings surfaced on Settings → General.
 *
 * Mirrors the columns the Tenant Service persists on `tenant_settings`
 * (Task 40.1). The page only edits the user-facing subset described in
 * Requirement 42 AC 1 and Requirement 43; the rest of the tenant config
 * payload (branding, security, features) is owned by other pages.
 */
export interface TenantGeneralSettings {
  /**
   * Tenant brand name (Requirement 43 — Configurable display name).
   * 1–40 characters; the source of truth for `<title>` and email
   * subject substitutions.
   */
  brandName: string;
  /**
   * Default UI locale for new users in this tenant. Must be one of the
   * tenant's supported locales (managed in code; see
   * `LanguageProvider.SUPPORTED_LOCALES`).
   */
  defaultLanguage: string;
  /**
   * Default theme mode applied for users who haven't picked one yet
   * (Requirement 36).
   */
  defaultThemeMode: 'light' | 'dark' | 'system';
  /**
   * Contact address for system notifications (e.g. failed sync alerts,
   * billing notices). Must be a valid email.
   */
  notificationsEmail: string;
  /**
   * IANA timezone (e.g. `Asia/Kolkata`) used as the default for
   * scheduling, attendance windows, and audit timestamps.
   */
  tenantTimezone: string;
}

export async function getTenantGeneralSettings(
  options: AdminClientOptions = {},
): Promise<TenantGeneralSettings> {
  const result = await adminFetch<TenantGeneralSettings>(
    ADMIN_API_ENDPOINTS.TENANT_SETTINGS,
    { method: 'GET' },
    options,
  );
  return result;
}
