/**
 * Roles & Permissions Repository (Task 59.3)
 *
 * Defines the data-access contract for tenant-scoped roles, permissions,
 * and role-to-user assignments used by the Settings → Roles & Permissions
 * surface (Requirement 42 AC 4).
 *
 * Storage notes:
 * - Tenant-scoped roles live in `tenant_roles` (id, tenantId, name, description,
 *   builtIn, permissions JSONB).
 * - Built-in roles are seeded from `@proctira/auth` `DEFAULT_ROLES` and are
 *   read-only — the service rejects mutations against them.
 * - Permissions are referenced by `(resource, action)` pairs that mirror the
 *   policy registry from task 39.1, so the matrix the UI renders is bound to
 *   the same authorization vocabulary the backend evaluates.
 * - Assignments live in `tenant_user_roles` (userId × roleId, tenantId).
 */

import type { PaginationOptions, PaginatedResult } from '@proctira/common';

// ─── Entity Types ──────────────────────────────────────────────────────────

/** Permission entry mirrored from the policy registry. */
export interface PermissionRef {
  /** Resource being accessed, e.g. `student`, `institution`, `*`. */
  resource: string;
  /** Action being performed; `manage` grants every action on the resource. */
  action: 'create' | 'read' | 'update' | 'delete' | 'list' | 'manage';
}

/** Tenant-scoped role definition. */
export interface RoleEntity {
  id: string;
  tenantId: string;
  /** Stable role identifier (`super-admin`, `admin`, `principal`, …). */
  roleId: string;
  /** Human-readable role name. */
  name: string;
  description: string | null;
  /** Built-in roles seeded from DEFAULT_ROLES are read-only. */
  builtIn: boolean;
  permissions: PermissionRef[];
  createdAt: Date;
  updatedAt: Date;
}

/** Listing of users available to the role-assignment grid. */
export interface UserRecord {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  /** Role IDs currently assigned to this user. */
  roleIds: string[];
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  /** IdP-side identifier pushed by SCIM provisioning (PRC-M025). */
  externalId?: string;
}

/** Filter options for listing users. */
export interface UserListFilter {
  /** Free-text search across name + email. */
  search?: string;
  /** Filter to users that hold this role. */
  roleId?: string;
  status?: UserRecord['status'];
}

/**
 * PRC-M026: one exact-match lookup (the `attribute eq "value"` filters SCIM
 * IdPs send) and/or a role-membership filter, evaluated by the store.
 */
export interface UserQuery {
  /** Case-insensitive exact match on one attribute. */
  match?: { attribute: 'email' | 'externalId' | 'id' | 'displayName'; value: string };
  /** Only users holding this role id. */
  roleId?: string;
}

/** PRC-M026: offset window over the ordered (displayName, id) user list. */
export interface UserQueryWindow {
  offset: number;
  limit: number;
}

// ─── Repository Interface ──────────────────────────────────────────────────

/** Repository contract for the Settings → Roles & Permissions surface. */
export interface RolesRepository {
  // Roles ----------------------------------------------------------------
  listRoles(tenantId: string): Promise<RoleEntity[]>;
  findRoleById(tenantId: string, id: string): Promise<RoleEntity | null>;
  findRoleByName(tenantId: string, name: string): Promise<RoleEntity | null>;
  createRole(data: Omit<RoleEntity, 'createdAt' | 'updatedAt'>): Promise<RoleEntity>;
  /**
   * PRC-L371: atomically create a role only when no role with the same name
   * (case-insensitive) already exists in the tenant. Returns the created role,
   * or `null` when a same-named role is already present. Replaces the
   * check-then-insert race in `RolesService.createRole`.
   */
  createRoleIfNameAbsent(
    data: Omit<RoleEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<RoleEntity | null>;
  updateRole(
    tenantId: string,
    id: string,
    data: Partial<Omit<RoleEntity, 'id' | 'tenantId' | 'builtIn' | 'createdAt' | 'updatedAt'>>,
  ): Promise<RoleEntity | null>;
  deleteRole(tenantId: string, id: string): Promise<boolean>;

  // Users ----------------------------------------------------------------
  listUsers(
    tenantId: string,
    filter: UserListFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<UserRecord>>;
  findUserById(tenantId: string, id: string): Promise<UserRecord | null>;
  /**
   * PRC-M026: filter + window evaluated by the store (SQL for Postgres) so a
   * SCIM lookup or page never loads the whole tenant directory. Returns the
   * window and the total match count.
   */
  queryUsers?(
    tenantId: string,
    query: UserQuery,
    window: UserQueryWindow,
  ): Promise<{ data: UserRecord[]; total: number }>;
  findUserByEmail(tenantId: string, email: string): Promise<UserRecord | null>;
  /** Create or replace a user record (G-910 invite / directory sync). */
  upsertUser(user: UserRecord): Promise<UserRecord>;
  /**
   * PRC-L371: atomically insert a user only when no user with the same e-mail
   * (case-insensitive) already exists in the tenant. Returns the created
   * record, or `null` when the e-mail is already taken. Replaces the
   * check-then-insert race in `RolesService.inviteUser`.
   */
  insertUserIfEmailAbsent(user: UserRecord): Promise<UserRecord | null>;
  setUserRoles(tenantId: string, userId: string, roleIds: string[]): Promise<UserRecord | null>;
  /**
   * PRC-M026: read-modify-write of one user's role list as a single atomic step
   * (row lock / no interleaving), so concurrent membership changes for the same
   * user cannot overwrite each other. Returns null when the user is absent.
   */
  updateUserRolesAtomic?(
    tenantId: string,
    userId: string,
    mutate: (current: string[]) => string[],
  ): Promise<{ before: string[]; user: UserRecord } | null>;
}
