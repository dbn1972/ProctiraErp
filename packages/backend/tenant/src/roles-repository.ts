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
}

/** Filter options for listing users. */
export interface UserListFilter {
  /** Free-text search across name + email. */
  search?: string;
  /** Filter to users that hold this role. */
  roleId?: string;
  status?: UserRecord['status'];
}

// ─── Repository Interface ──────────────────────────────────────────────────

/** Repository contract for the Settings → Roles & Permissions surface. */
export interface RolesRepository {
  // Roles ----------------------------------------------------------------
  listRoles(tenantId: string): Promise<RoleEntity[]>;
  findRoleById(tenantId: string, id: string): Promise<RoleEntity | null>;
  findRoleByName(tenantId: string, name: string): Promise<RoleEntity | null>;
  createRole(data: Omit<RoleEntity, 'createdAt' | 'updatedAt'>): Promise<RoleEntity>;
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
  findUserByEmail(tenantId: string, email: string): Promise<UserRecord | null>;
  /** Create or replace a user record (G-910 invite / directory sync). */
  upsertUser(user: UserRecord): Promise<UserRecord>;
  setUserRoles(tenantId: string, userId: string, roleIds: string[]): Promise<UserRecord | null>;
}
