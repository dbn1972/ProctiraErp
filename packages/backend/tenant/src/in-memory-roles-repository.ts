/**
 * In-Memory Roles Repository
 *
 * Test/dev implementation of `RolesRepository` (Task 59.3). Accepts a list of
 * "built-in" role definitions to seed per-tenant; in production they come
 * from `DEFAULT_ROLES` in `@proctira/auth` (the route layer wires that in).
 */

import type { PaginationOptions, PaginatedResult } from '@proctira/common';

import type {
  PermissionRef,
  RoleEntity,
  RolesRepository,
  UserListFilter,
  UserRecord,
} from './roles-repository.js';

/** Seed definition for a built-in role. */
export interface BuiltInRoleSeed {
  /** Stable role identifier (`super-admin`, `admin`, `principal`, …). */
  roleId: string;
  /** Human-readable role name. */
  roleName: string;
  /** Permissions this role grants. */
  permissions: PermissionRef[];
}

function deterministicId(parts: string[]): string {
  return parts.join('::');
}

/**
 * In-memory implementation of `RolesRepository` for unit + integration tests.
 *
 * - Seeds `DEFAULT_ROLES` per tenant the first time the tenant is referenced.
 * - Tracks soft-id collisions (role name uniqueness within tenant).
 * - Backs the user grid with a small in-memory list that tests can extend.
 */
export class InMemoryRolesRepository implements RolesRepository {
  private rolesByTenant = new Map<string, Map<string, RoleEntity>>();
  private usersByTenant = new Map<string, Map<string, UserRecord>>();
  private readonly seed: BuiltInRoleSeed[];

  constructor(seed: BuiltInRoleSeed[] = []) {
    this.seed = seed;
  }

  /** Optional seed of default users for a tenant. */
  seedUsers(tenantId: string, users: UserRecord[]): void {
    const map = new Map<string, UserRecord>();
    for (const u of users) {
      map.set(u.id, { ...u, tenantId });
    }
    this.usersByTenant.set(tenantId, map);
  }

  private ensureTenant(tenantId: string): Map<string, RoleEntity> {
    const existing = this.rolesByTenant.get(tenantId);
    if (existing) return existing;

    const fresh = new Map<string, RoleEntity>();
    const now = new Date();
    for (const def of this.seed) {
      const id = deterministicId([tenantId, def.roleId]);
      fresh.set(id, {
        id,
        tenantId,
        roleId: def.roleId,
        name: def.roleName,
        description: null,
        builtIn: true,
        permissions: def.permissions.map((p) => ({ ...p })),
        createdAt: now,
        updatedAt: now,
      });
    }
    this.rolesByTenant.set(tenantId, fresh);
    return fresh;
  }

  // ─── Roles ────────────────────────────────────────────────────────────

  async listRoles(tenantId: string): Promise<RoleEntity[]> {
    const map = this.ensureTenant(tenantId);
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  async findRoleById(tenantId: string, id: string): Promise<RoleEntity | null> {
    const map = this.ensureTenant(tenantId);
    return map.get(id) ?? null;
  }

  async findRoleByName(tenantId: string, name: string): Promise<RoleEntity | null> {
    const map = this.ensureTenant(tenantId);
    const lower = name.trim().toLowerCase();
    for (const role of map.values()) {
      if (role.name.toLowerCase() === lower) return role;
    }
    return null;
  }

  async createRole(data: Omit<RoleEntity, 'createdAt' | 'updatedAt'>): Promise<RoleEntity> {
    const map = this.ensureTenant(data.tenantId);
    const now = new Date();
    const entity: RoleEntity = { ...data, createdAt: now, updatedAt: now };
    map.set(entity.id, entity);
    return entity;
  }

  async updateRole(
    tenantId: string,
    id: string,
    data: Partial<Omit<RoleEntity, 'id' | 'tenantId' | 'builtIn' | 'createdAt' | 'updatedAt'>>,
  ): Promise<RoleEntity | null> {
    const map = this.ensureTenant(tenantId);
    const existing = map.get(id);
    if (!existing) return null;

    const next: RoleEntity = {
      ...existing,
      ...data,
      // permissions copied to break aliasing
      permissions: data.permissions
        ? data.permissions.map((p) => ({ ...p }))
        : existing.permissions,
      updatedAt: new Date(),
    };
    map.set(id, next);
    return next;
  }

  async deleteRole(tenantId: string, id: string): Promise<boolean> {
    const map = this.ensureTenant(tenantId);
    if (!map.has(id)) return false;
    map.delete(id);

    // Remove the deleted role from any user that holds it.
    const users = this.usersByTenant.get(tenantId);
    if (users) {
      for (const u of users.values()) {
        if (u.roleIds.includes(id)) {
          u.roleIds = u.roleIds.filter((r) => r !== id);
        }
      }
    }
    return true;
  }

  // ─── Users ────────────────────────────────────────────────────────────

  async listUsers(
    tenantId: string,
    filter: UserListFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<UserRecord>> {
    const map = this.usersByTenant.get(tenantId) ?? new Map<string, UserRecord>();
    let rows = Array.from(map.values());

    if (filter.search && filter.search.trim()) {
      const q = filter.search.trim().toLowerCase();
      rows = rows.filter(
        (u) => u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q),
      );
    }
    if (filter.roleId) {
      rows = rows.filter((u) => u.roleIds.includes(filter.roleId!));
    }
    if (filter.status) {
      rows = rows.filter((u) => u.status === filter.status);
    }

    rows.sort((a, b) => a.displayName.localeCompare(b.displayName));

    const page = pagination.page ?? 1;
    const pageSize = pagination.pageSize ?? 20;
    const totalItems = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const offset = (page - 1) * pageSize;
    const data = rows.slice(offset, offset + pageSize);

    return {
      data,
      meta: { page, pageSize, totalItems, totalPages },
    };
  }

  async findUserById(tenantId: string, id: string): Promise<UserRecord | null> {
    const map = this.usersByTenant.get(tenantId);
    const user = map?.get(id);
    if (!user) return null;
    return { ...user, roleIds: [...user.roleIds] };
  }

  async findUserByEmail(tenantId: string, email: string): Promise<UserRecord | null> {
    const map = this.usersByTenant.get(tenantId);
    if (!map) return null;
    const lower = email.trim().toLowerCase();
    for (const user of map.values()) {
      if (user.email.toLowerCase() === lower) return { ...user, roleIds: [...user.roleIds] };
    }
    return null;
  }

  async upsertUser(user: UserRecord): Promise<UserRecord> {
    let map = this.usersByTenant.get(user.tenantId);
    if (!map) {
      map = new Map<string, UserRecord>();
      this.usersByTenant.set(user.tenantId, map);
    }
    const stored: UserRecord = { ...user, roleIds: [...user.roleIds] };
    map.set(user.id, stored);
    return { ...stored, roleIds: [...stored.roleIds] };
  }

  async setUserRoles(
    tenantId: string,
    userId: string,
    roleIds: string[],
  ): Promise<UserRecord | null> {
    const map = this.usersByTenant.get(tenantId);
    const user = map?.get(userId);
    if (!user) return null;

    user.roleIds = [...new Set(roleIds)];
    return { ...user, roleIds: [...user.roleIds] };
  }
}
