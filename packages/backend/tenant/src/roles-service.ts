/**
 * Roles & Permissions Service (Task 59.3 / Requirement 42 AC 4–5)
 *
 * Backs the Settings → Roles & Permissions surface (Design §R.3) and emits a
 * high-risk audit event (Requirement 33 AC 4) for every mutation so the
 * platform can correlate the actor, the previous state, and the new state of
 * any role-permission change.
 *
 * Key invariants:
 *   • Built-in roles seeded from `DEFAULT_ROLES` are read-only — name,
 *     description, and permissions cannot be mutated, and the role cannot be
 *     deleted (returns `BusinessRuleError`).
 *   • Custom (tenant-scoped) roles must have a unique name within the tenant.
 *   • Every mutation calls `emitAudit` with `entityType = 'role'` so the audit
 *     pipeline can mark the event as high-risk; the route layer is the
 *     concrete consumer that hands those records to `@proctira/backend-audit`.
 *   • Updating a role's permissions does NOT cache anything — the next request
 *     by any user holding the role evaluates against the freshly-stored
 *     permissions (Requirement 42 AC 5).
 */

import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  PermissionRef,
  RoleEntity,
  RolesRepository,
  UserListFilter,
  UserRecord,
} from './roles-repository.js';

// ─── Audit hook ───────────────────────────────────────────────────────────

/**
 * Audit operation classification recorded against role/user changes.
 *
 * Mirrors `AuditOperation` from `@proctira/backend-audit` without taking a
 * direct dependency — the route layer translates this into the audit
 * service's contract and adds `metadata.riskLevel = 'high'` (Requirement 33
 * AC 4).
 */
export type RolesAuditOperation = 'CREATE' | 'UPDATE' | 'DELETE';

/** Payload handed to the audit hook for every role/user mutation. */
export interface RolesAuditEvent {
  tenantId: string;
  /** `role` for permission/role mutations, `user` for assignment mutations. */
  entityType: 'role' | 'user';
  entityId: string;
  operation: RolesAuditOperation;
  beforeValues: Record<string, unknown> | null;
  afterValues: Record<string, unknown> | null;
  /**
   * Audit metadata — always carries `riskLevel: 'high'` so downstream sinks
   * (e.g. SIEM, fraud queues) can fan-out the event.
   */
  metadata: Record<string, unknown> & { riskLevel: 'high' };
}

/**
 * Hook the route layer wires to the audit service. The service stays
 * decoupled from `@proctira/backend-audit` so it can be unit tested against
 * a recording stub.
 */
export type RolesAuditEmitter = (event: RolesAuditEvent) => Promise<void> | void;

// ─── Inputs ───────────────────────────────────────────────────────────────

export interface CreateRoleInput {
  name: string;
  description?: string | null;
  permissions: PermissionRef[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  permissions?: PermissionRef[];
}

// ─── Service ──────────────────────────────────────────────────────────────

/**
 * Settings → Roles & Permissions service.
 *
 * The audit emitter is optional so the service can be exercised in unit
 * tests without an audit pipeline; the route layer (`roles-routes.ts`) is
 * always responsible for plumbing the production emitter.
 */
export class RolesService {
  constructor(
    private readonly repository: RolesRepository,
    private readonly emitAudit: RolesAuditEmitter = async () => undefined,
  ) {}

  // ─── Permission catalog ────────────────────────────────────────────────

  /**
   * Returns the catalog of (resource, action) pairs the policy registry
   * supports. The matrix UI uses this list to render rows. Mirrored from
   * `@proctira/auth` `DEFAULT_ROLES` — anything granted by a built-in role
   * is part of the catalog.
   *
   * Computed lazily so dropping a built-in role from `DEFAULT_ROLES`
   * automatically removes it from the matrix.
   */
  async listPermissionCatalog(tenantId: string): Promise<PermissionRef[]> {
    const roles = await this.repository.listRoles(tenantId);
    const seen = new Map<string, PermissionRef>();
    for (const role of roles) {
      for (const p of role.permissions) {
        const key = `${p.resource}:${p.action}`;
        if (!seen.has(key)) seen.set(key, { ...p });
      }
    }
    // Make sure the wildcards always appear so super-admin roles render correctly.
    if (!seen.has('*:manage')) seen.set('*:manage', { resource: '*', action: 'manage' });
    return Array.from(seen.values());
  }

  // ─── Roles ─────────────────────────────────────────────────────────────

  async listRoles(tenantId: string): Promise<RoleEntity[]> {
    return this.repository.listRoles(tenantId);
  }

  async getRole(tenantId: string, id: string): Promise<RoleEntity> {
    const role = await this.repository.findRoleById(tenantId, id);
    if (!role) throw new NotFoundError(`Role with id '${id}' not found`);
    return role;
  }

  async createRole(tenantId: string, input: CreateRoleInput): Promise<RoleEntity> {
    this.validateRoleName(input.name);
    this.validatePermissions(input.permissions);

    const collision = await this.repository.findRoleByName(tenantId, input.name);
    if (collision) {
      throw new ConflictError(`Role with name '${input.name}' already exists`);
    }

    const id = uuidv4();
    const role = await this.repository.createRole({
      id,
      tenantId,
      roleId: id,
      name: input.name.trim(),
      description: input.description ?? null,
      builtIn: false,
      permissions: input.permissions.map((p) => ({ ...p })),
    });

    await this.emitAudit({
      tenantId,
      entityType: 'role',
      entityId: role.id,
      operation: 'CREATE',
      beforeValues: null,
      afterValues: this.snapshot(role),
      metadata: {
        riskLevel: 'high',
        change: 'role_created',
      },
    });

    return role;
  }

  /**
   * Update a role's metadata and/or permissions.
   *
   * - Built-in roles are read-only — we throw `BusinessRuleError`.
   * - The audit event always captures both `beforeValues` and `afterValues`
   *   so the audit-trail viewer can render a diff.
   * - The new permissions take effect on the next request because the policy
   *   evaluator reads role permissions per-request from the repository.
   */
  async updateRole(tenantId: string, id: string, input: UpdateRoleInput): Promise<RoleEntity> {
    const existing = await this.repository.findRoleById(tenantId, id);
    if (!existing) throw new NotFoundError(`Role with id '${id}' not found`);
    if (existing.builtIn) {
      throw new BusinessRuleError(
        `Built-in role '${existing.name}' is read-only and cannot be modified`,
      );
    }

    if (input.name && input.name.trim() !== existing.name) {
      this.validateRoleName(input.name);
      const collision = await this.repository.findRoleByName(tenantId, input.name);
      if (collision && collision.id !== id) {
        throw new ConflictError(`Role with name '${input.name}' already exists`);
      }
    }
    if (input.permissions) this.validatePermissions(input.permissions);

    const before = this.snapshot(existing);
    const updated = await this.repository.updateRole(tenantId, id, {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.permissions !== undefined
        ? { permissions: input.permissions.map((p) => ({ ...p })) }
        : {}),
    });
    if (!updated) throw new NotFoundError(`Role with id '${id}' not found`);

    await this.emitAudit({
      tenantId,
      entityType: 'role',
      entityId: id,
      operation: 'UPDATE',
      beforeValues: before,
      afterValues: this.snapshot(updated),
      metadata: {
        riskLevel: 'high',
        change:
          input.permissions !== undefined ? 'role_permissions_changed' : 'role_metadata_changed',
      },
    });

    return updated;
  }

  /**
   * Replace a role's permission set wholesale. Convenience wrapper around
   * `updateRole` that records `change: 'role_permissions_changed'` in the
   * audit metadata.
   */
  async updateRolePermissions(
    tenantId: string,
    id: string,
    permissions: PermissionRef[],
  ): Promise<RoleEntity> {
    return this.updateRole(tenantId, id, { permissions });
  }

  async deleteRole(tenantId: string, id: string): Promise<void> {
    const existing = await this.repository.findRoleById(tenantId, id);
    if (!existing) throw new NotFoundError(`Role with id '${id}' not found`);
    if (existing.builtIn) {
      throw new BusinessRuleError(
        `Built-in role '${existing.name}' is read-only and cannot be deleted`,
      );
    }

    await this.repository.deleteRole(tenantId, id);

    await this.emitAudit({
      tenantId,
      entityType: 'role',
      entityId: id,
      operation: 'DELETE',
      beforeValues: this.snapshot(existing),
      afterValues: null,
      metadata: {
        riskLevel: 'high',
        change: 'role_deleted',
      },
    });
  }

  // ─── Users / Assignments ───────────────────────────────────────────────

  async listUsers(
    tenantId: string,
    filter: UserListFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<UserRecord>> {
    return this.repository.listUsers(tenantId, filter, pagination);
  }

  /**
   * Replace the role assignments for a single user.
   *
   * Validates that every requested role belongs to the same tenant — assigning
   * a role from another tenant is a hard error.
   */
  async assignRolesToUser(
    tenantId: string,
    userId: string,
    roleIds: string[],
  ): Promise<UserRecord> {
    const before = await this.repository.findUserById(tenantId, userId);
    if (!before) throw new NotFoundError(`User with id '${userId}' not found`);
    // Snapshot the previous role list before the repository mutates the record.
    const previousRoleIds = [...before.roleIds];

    const dedup = Array.from(new Set(roleIds));
    for (const rid of dedup) {
      const role = await this.repository.findRoleById(tenantId, rid);
      if (!role) {
        throw new ValidationError('Role assignment references unknown role', [
          {
            field: 'roleIds',
            rule: 'unknown',
            message: `Role '${rid}' does not exist in this tenant`,
          },
        ]);
      }
    }

    const updated = await this.repository.setUserRoles(tenantId, userId, dedup);
    if (!updated) throw new NotFoundError(`User with id '${userId}' not found`);

    await this.emitAudit({
      tenantId,
      entityType: 'user',
      entityId: userId,
      operation: 'UPDATE',
      beforeValues: { roleIds: previousRoleIds },
      afterValues: { roleIds: [...updated.roleIds] },
      metadata: {
        riskLevel: 'high',
        change: 'user_roles_assigned',
      },
    });

    return updated;
  }

  /**
   * G-910 — invite a user into the tenant directory. Creates an `INVITED`
   * record (the IdP invite e-mail is the auth module's job; this is the
   * tenant-side membership + role assignment that the admin console manages).
   */
  async inviteUser(
    tenantId: string,
    input: { email: string; displayName: string; roleIds: string[] },
  ): Promise<UserRecord> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ValidationError('Invalid e-mail address', [
        { field: 'email', rule: 'format', message: 'email must be a valid address' },
      ]);
    }
    const existing = await this.repository.findUserByEmail(tenantId, email);
    if (existing) {
      throw new ConflictError(`A user with e-mail '${email}' already exists in this tenant`);
    }
    const dedup = Array.from(new Set(input.roleIds));
    for (const rid of dedup) {
      const role = await this.repository.findRoleById(tenantId, rid);
      if (!role) {
        throw new ValidationError('Role assignment references unknown role', [
          { field: 'roleIds', rule: 'unknown', message: `Role '${rid}' does not exist` },
        ]);
      }
    }
    const user = await this.repository.upsertUser({
      id: uuidv4(),
      tenantId,
      email,
      displayName: input.displayName.trim() || email,
      roleIds: dedup,
      status: 'INVITED',
    });
    await this.emitAudit({
      tenantId,
      entityType: 'user',
      entityId: user.id,
      operation: 'CREATE',
      beforeValues: null,
      afterValues: { email: user.email, roleIds: [...user.roleIds], status: user.status },
      metadata: { riskLevel: 'high', change: 'user_invited' },
    });
    return user;
  }

  /** PRC-M026: single-row user lookup (no directory scan). */
  async getUser(tenantId: string, userId: string): Promise<UserRecord> {
    const user = await this.repository.findUserById(tenantId, userId);
    if (!user) throw new NotFoundError(`User with id '${userId}' not found`);
    return user;
  }

  async findUserByEmail(tenantId: string, email: string): Promise<UserRecord | null> {
    return this.repository.findUserByEmail(tenantId, email.trim().toLowerCase());
  }

  /**
   * PRC-M025: update directory profile attributes pushed by an IdP (SCIM PUT /
   * PATCH): display name, e-mail (unique per tenant) and externalId.
   */
  async updateUserProfile(
    tenantId: string,
    userId: string,
    patch: { displayName?: string; email?: string; externalId?: string | null },
  ): Promise<UserRecord> {
    const before = await this.getUser(tenantId, userId);
    const next: UserRecord = { ...before, roleIds: [...before.roleIds] };
    if (patch.displayName !== undefined) {
      const name = patch.displayName.trim();
      if (!name) {
        throw new ValidationError('displayName must not be empty', [
          { field: 'displayName', rule: 'required', message: 'displayName is required' },
        ]);
      }
      next.displayName = name;
    }
    if (patch.email !== undefined) {
      const email = patch.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ValidationError('Invalid e-mail address', [
          { field: 'email', rule: 'format', message: 'email must be a valid address' },
        ]);
      }
      if (email !== before.email.toLowerCase()) {
        const clash = await this.repository.findUserByEmail(tenantId, email);
        if (clash && clash.id !== userId) {
          throw new ConflictError(`A user with e-mail '${email}' already exists in this tenant`);
        }
      }
      next.email = email;
    }
    if (patch.externalId !== undefined) {
      if (patch.externalId === null || patch.externalId.trim() === '') delete next.externalId;
      else next.externalId = patch.externalId.trim();
    }
    const changed = (['displayName', 'email', 'externalId'] as const).filter(
      (k) => before[k] !== next[k],
    );
    if (changed.length === 0) return before;
    const updated = await this.repository.upsertUser(next);
    await this.emitAudit({
      tenantId,
      entityType: 'user',
      entityId: userId,
      operation: 'UPDATE',
      beforeValues: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])),
      afterValues: Object.fromEntries(changed.map((k) => [k, updated[k] ?? null])),
      metadata: { riskLevel: 'high', change: 'user_profile_updated', changedFields: changed },
    });
    return updated;
  }

  private readonly roleLocks = new Map<string, Promise<unknown>>();

  /**
   * PRC-M026: add / remove role memberships for one user atomically. Uses the
   * repository's locked read-modify-write when available; otherwise serialises
   * per user within this process. Never writes from a stale snapshot.
   */
  async modifyUserRoles(
    tenantId: string,
    userId: string,
    change: { add?: string[]; remove?: string[] },
  ): Promise<UserRecord> {
    const add = [...new Set(change.add ?? [])];
    const remove = new Set(change.remove ?? []);
    for (const rid of add) {
      if (!(await this.repository.findRoleById(tenantId, rid))) {
        throw new ValidationError('Role assignment references unknown role', [
          { field: 'roleIds', rule: 'unknown', message: `Role '${rid}' does not exist` },
        ]);
      }
    }
    const mutate = (current: string[]) =>
      [...current, ...add].filter((rid) => !remove.has(rid) || add.includes(rid));
    let result: { before: string[]; user: UserRecord } | null;
    if (this.repository.updateUserRolesAtomic) {
      result = await this.repository.updateUserRolesAtomic(tenantId, userId, mutate);
    } else {
      const key = `${tenantId}:${userId}`;
      const prior = this.roleLocks.get(key) ?? Promise.resolve();
      const run = prior
        .catch(() => undefined)
        .then(async () => {
          const user = await this.repository.findUserById(tenantId, userId);
          if (!user) return null;
          const before = [...user.roleIds];
          const updated = await this.repository.setUserRoles(tenantId, userId, mutate(before));
          return updated ? { before, user: updated } : null;
        });
      this.roleLocks.set(key, run);
      try {
        result = await run;
      } finally {
        if (this.roleLocks.get(key) === run) this.roleLocks.delete(key);
      }
    }
    if (!result) throw new NotFoundError(`User with id '${userId}' not found`);
    const { before, user } = result;
    if (before.length !== user.roleIds.length || before.some((r, i) => r !== user.roleIds[i])) {
      await this.emitAudit({
        tenantId,
        entityType: 'user',
        entityId: userId,
        operation: 'UPDATE',
        beforeValues: { roleIds: before },
        afterValues: { roleIds: [...user.roleIds] },
        metadata: { riskLevel: 'high', change: 'user_roles_modified' },
      });
    }
    return user;
  }

  /** G-910 — suspend / reactivate a directory user. */
  async setUserStatus(
    tenantId: string,
    userId: string,
    status: 'ACTIVE' | 'SUSPENDED',
  ): Promise<UserRecord> {
    const before = await this.repository.findUserById(tenantId, userId);
    if (!before) throw new NotFoundError(`User with id '${userId}' not found`);
    if (before.status === status) return before;
    const updated = await this.repository.upsertUser({ ...before, status });
    await this.emitAudit({
      tenantId,
      entityType: 'user',
      entityId: userId,
      operation: 'UPDATE',
      beforeValues: { status: before.status },
      afterValues: { status: updated.status },
      metadata: { riskLevel: 'high', change: 'user_status_changed' },
    });
    return updated;
  }

  // ─── Validation helpers ────────────────────────────────────────────────

  private validateRoleName(name: string): void {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new ValidationError('Role name is required', [
        { field: 'name', rule: 'required', message: 'name is required' },
      ]);
    }
    if (trimmed.length > 80) {
      throw new ValidationError('Role name is too long', [
        { field: 'name', rule: 'maxLength', message: 'name must be at most 80 characters' },
      ]);
    }
  }

  private validatePermissions(permissions: PermissionRef[]): void {
    if (!Array.isArray(permissions)) {
      throw new ValidationError('Permissions must be an array', [
        { field: 'permissions', rule: 'type', message: 'permissions must be an array' },
      ]);
    }
    const errors: { field: string; rule: string; message: string }[] = [];
    permissions.forEach((p, idx) => {
      if (!p.resource || typeof p.resource !== 'string') {
        errors.push({
          field: `permissions[${idx}].resource`,
          rule: 'required',
          message: 'resource is required',
        });
      }
      const validActions = ['create', 'read', 'update', 'delete', 'list', 'manage'];
      if (!validActions.includes(p.action)) {
        errors.push({
          field: `permissions[${idx}].action`,
          rule: 'enum',
          message: `action must be one of ${validActions.join(', ')}`,
        });
      }
    });
    if (errors.length > 0) {
      throw new ValidationError('Invalid permissions payload', errors);
    }
  }

  /**
   * Render a stable, JSON-serialisable view of a role for audit storage.
   * Note: the audit table stores `Record<string, unknown>`; the stable
   * field order keeps diffs human-readable.
   */
  private snapshot(role: RoleEntity): Record<string, unknown> {
    return {
      id: role.id,
      name: role.name,
      description: role.description,
      builtIn: role.builtIn,
      permissions: [...role.permissions]
        .sort((a, b) =>
          a.resource === b.resource
            ? a.action.localeCompare(b.action)
            : a.resource.localeCompare(b.resource),
        )
        .map((p) => ({ ...p })),
    };
  }
}
