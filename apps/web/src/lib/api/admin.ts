/**
 * Admin service client (users, roles, permissions, tenant config).
 *
 * Validates: Requirement 4.x — tenant administration; cross-cutting role
 * and permission management used by all modules. Task 59.3 — Settings →
 * Roles & Permissions wires this client into the matrix UI.
 *
 * The module exposes two stripes of helpers:
 *
 *   • Server-side helpers (`listUsers`, `listRoles`, `listPermissions`,
 *     `getTenantConfig`) that go through `gatewayFetch` for use by Next.js
 *     Server Components and Server Actions. These predate task 59.3 and
 *     stay here for backwards compatibility.
 *
 *   • Client-side helpers used by the federated React Router shell
 *     (`apps/web/src/RootRouter.tsx`). These talk to the gateway directly
 *     using `fetch` and are the surface the Roles & Permissions page
 *     consumes. Every mutation calls `recordHighRiskAuditEvent()` so the
 *     audit log captures a high-risk record per Requirement 33 AC 4 /
 *     Requirement 42 AC 5.
 */

// ────────────────────────────────────────────────────────────────────────
// Server-side helpers (existing — kept for SC / Server Actions)
// NOTE: Server-side functions that use gatewayFetch have been moved to
// ./admin.server.ts to avoid pulling next/headers into client bundles.
// ────────────────────────────────────────────────────────────────────────

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
  /**
   * High-risk audit event endpoint (per task 59.3 contract).
   *
   * The gateway aliases this to the audit service's create endpoint
   * (`POST /api/v1/audit` in `@proctira/backend-audit`). The dedicated
   * `/events` suffix lets the gateway namespace high-risk records for
   * routing to a SIEM sidechannel without touching the bulk audit API.
   */
  AUDIT_EVENTS: '/api/v1/audit/events',
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

/**
 * Audit risk levels recognised by the audit pipeline. The Roles & Permissions
 * page only ever emits `high` (Requirement 33 AC 4), but we type the union
 * for clarity.
 */
export type AuditRiskLevel = 'low' | 'medium' | 'high';

/** High-risk audit event payload sent on every mutation. */
export interface HighRiskAuditEvent {
  entityType: 'role' | 'user';
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  beforeValues?: Record<string, unknown> | null;
  afterValues?: Record<string, unknown> | null;
  /**
   * Human-readable summary of the change. The backend audit service stores
   * this in `metadata.summary` for the inline "recent changes" list rendered
   * in §R.3 of the design.
   */
  summary: string;
  /** Always `'high'` — exposed on the type so consumers can be explicit. */
  riskLevel: AuditRiskLevel;
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

async function adminFetch<T>(
  url: string,
  init: RequestInit = {},
  options: AdminClientOptions = {},
): Promise<T> {
  const fetcher = options.fetcher ?? fetch;
  const headers = new Headers(init.headers);
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

// ─── Audit emitter ───────────────────────────────────────────────────────

/**
 * Posts a high-risk audit event to the audit service.
 *
 * Requirement 33 AC 4 mandates that every authorization-policy change is
 * recorded with the actor, the previous policy state, and the new policy
 * state. The Roles & Permissions UI calls this helper after every mutation
 * succeeds. Failures are bubbled up so the UI can surface a warning — the
 * Settings page treats audit-pipeline failures as non-fatal but visible
 * (the role mutation has already succeeded server-side).
 */
export async function recordHighRiskAuditEvent(
  event: Omit<HighRiskAuditEvent, 'riskLevel'> & Partial<Pick<HighRiskAuditEvent, 'riskLevel'>>,
  options: AdminClientOptions = {},
): Promise<void> {
  const body = {
    entityType: event.entityType,
    entityId: event.entityId,
    operation: event.operation,
    beforeValues: event.beforeValues ?? null,
    afterValues: event.afterValues ?? null,
    metadata: {
      riskLevel: event.riskLevel ?? 'high',
      summary: event.summary,
    },
  };

  await adminFetch<void>(
    ADMIN_API_ENDPOINTS.AUDIT_EVENTS,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    options,
  );
}

// ─── Roles ────────────────────────────────────────────────────────────────

export async function listTenantRoles(
  options: AdminClientOptions = {},
): Promise<TenantRole[]> {
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
  const role = await adminFetch<TenantRole>(
    ADMIN_API_ENDPOINTS.ROLES,
    { method: 'POST', body: JSON.stringify(payload) },
    options,
  );
  await recordHighRiskAuditEvent(
    {
      entityType: 'role',
      entityId: role.id,
      operation: 'CREATE',
      beforeValues: null,
      afterValues: { name: role.name, permissions: role.permissions },
      summary: `Created role '${role.name}'`,
    },
    options,
  );
  return role;
}

export interface UpdateRolePermissionsPayload {
  permissions: RolePermission[];
}

export async function updateRolePermissions(
  roleId: string,
  payload: UpdateRolePermissionsPayload,
  context: { roleName: string; previousPermissions: RolePermission[] },
  options: AdminClientOptions = {},
): Promise<TenantRole> {
  const role = await adminFetch<TenantRole>(
    `${ADMIN_API_ENDPOINTS.ROLES}/${encodeURIComponent(roleId)}/permissions`,
    { method: 'PATCH', body: JSON.stringify(payload) },
    options,
  );
  await recordHighRiskAuditEvent(
    {
      entityType: 'role',
      entityId: roleId,
      operation: 'UPDATE',
      beforeValues: { permissions: context.previousPermissions },
      afterValues: { permissions: role.permissions },
      summary: `Updated permissions on role '${context.roleName}'`,
    },
    options,
  );
  return role;
}

export async function deleteRole(
  roleId: string,
  context: { roleName: string },
  options: AdminClientOptions = {},
): Promise<void> {
  await adminFetch<void>(
    `${ADMIN_API_ENDPOINTS.ROLES}/${encodeURIComponent(roleId)}`,
    { method: 'DELETE' },
    options,
  );
  await recordHighRiskAuditEvent(
    {
      entityType: 'role',
      entityId: roleId,
      operation: 'DELETE',
      beforeValues: { name: context.roleName },
      afterValues: null,
      summary: `Deleted role '${context.roleName}'`,
    },
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

  const result = await adminFetch<PaginatedResponse<TenantUser>>(
    url,
    { method: 'GET' },
    options,
  );
  return (
    result ?? {
      data: [],
      meta: { page: filters.page ?? 1, pageSize: filters.pageSize ?? 20, totalItems: 0, totalPages: 1 },
    }
  );
}

export async function assignRolesToUser(
  userId: string,
  roleIds: string[],
  context: { userDisplayName: string; previousRoleIds: string[] },
  options: AdminClientOptions = {},
): Promise<TenantUser> {
  const user = await adminFetch<TenantUser>(
    `${ADMIN_API_ENDPOINTS.USERS}/${encodeURIComponent(userId)}/roles`,
    { method: 'PATCH', body: JSON.stringify({ roleIds }) },
    options,
  );
  await recordHighRiskAuditEvent(
    {
      entityType: 'user',
      entityId: userId,
      operation: 'UPDATE',
      beforeValues: { roleIds: context.previousRoleIds },
      afterValues: { roleIds: user.roleIds },
      summary: `Assigned ${user.roleIds.length} role(s) to '${context.userDisplayName}'`,
    },
    options,
  );
  return user;
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

/**
 * Patch payload for `PATCH /api/v1/tenant/settings`. Every field is
 * optional so the page can submit only the values the user actually
 * changed; the server merges with the existing record.
 */
export type TenantGeneralSettingsPatch = Partial<TenantGeneralSettings>;

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

export async function updateTenantGeneralSettings(
  patch: TenantGeneralSettingsPatch,
  options: AdminClientOptions = {},
): Promise<TenantGeneralSettings> {
  return adminFetch<TenantGeneralSettings>(
    ADMIN_API_ENDPOINTS.TENANT_SETTINGS,
    { method: 'PATCH', body: JSON.stringify(patch) },
    options,
  );
}
