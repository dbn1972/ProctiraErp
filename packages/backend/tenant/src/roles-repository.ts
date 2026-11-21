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

/**
 * PRC-L264: same-transaction audit port.
 *
 * The gateway injects a writer (over `@proctira/backend-audit`
 * `appendAuditEntryOnClient`) so a Postgres roles repository can append the
 * high-risk role/user audit row on the SAME `withPgTenant` client — and in the
 * SAME transaction — as the mutation itself. If the append throws, the whole
 * mutation rolls back, so a crash can never leave an unaudited role/user change
 * (and no separate post-hoc audit write is needed). This package takes no
 * dependency on `@proctira/backend-audit`; the port is the inversion boundary.
 */
export interface RolesTxnAuditEvent {
  tenantId: string;
  entityType: 'role' | 'user';
  entityId: string;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> & { riskLevel: 'high' };
  /** JWT `sub` of the caller; null when raised outside an authenticated request. */
  actorId: string | null;
  /** Client IP resolved by the gateway; null outside a request. */
  ipAddress: string | null;
  requestId: string | null;
}

/**
 * The injected client type is intentionally structural (`query(text, values)`)
 * so this package does not import a database client type. The gateway passes
 * the live `PgQueryable` from `withPgTenant`.
 */
export interface RolesTxnAuditClient {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface RolesTxnAuditPort {
  /** Append the audit row on the caller's transaction client. */
  appendAuditInTxn(client: RolesTxnAuditClient, event: RolesTxnAuditEvent): Promise<void>;
}

/**
 * PRC-L264: audit context a mutating repository call carries so the audit row
 * is written in the same transaction. Supplied by `RolesService` only when the
 * repository advertises `supportsTransactionalAudit`.
 */
export interface RolesAuditDirective {
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  metadata: Record<string, unknown> & { riskLevel: 'high' };
  actorId: string | null;
  ipAddress: string | null;
  requestId: string | null;
}

/** Repository contract for the Settings → Roles & Permissions surface. */
export interface RolesRepository {
  /**
   * PRC-L264: when `true`, the repository writes the high-risk role/user audit
   * row in the SAME transaction as the mutation (given a `RolesAuditDirective`),
   * so the service must NOT also emit a post-hoc audit event for the mutation.
   * Absent / `false` (e.g. the in-memory repository) keeps the post-hoc path.
   */
  readonly supportsTransactionalAudit?: boolean;

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
    audit?: RolesAuditDirective,
  ): Promise<RoleEntity | null>;
  updateRole(
    tenantId: string,
    id: string,
    data: Partial<Omit<RoleEntity, 'id' | 'tenantId' | 'builtIn' | 'createdAt' | 'updatedAt'>>,
    audit?: RolesAuditDirective,
  ): Promise<RoleEntity | null>;
  deleteRole(tenantId: string, id: string, audit?: RolesAuditDirective): Promise<boolean>;

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
  setUserRoles(
    tenantId: string,
    userId: string,
    roleIds: string[],
    audit?: RolesAuditDirective,
  ): Promise<UserRecord | null>;
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
