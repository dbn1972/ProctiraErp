/**
 * Postgres Roles & Permissions repository (G-910).
 *
 * Roles and directory users are tenant-scoped documents in
 * `control_plane_documents` (db/sql/022, RLS on tenant_id) via
 * PgDocumentCollection — the same store the tenant lifecycle uses — so the
 * admin console survives restarts without a dedicated schema.
 *
 * Built-in roles are seeded per tenant on first access (mirrors the
 * in-memory implementation), keyed `${tenantId}::${roleId}` so the ids are
 * stable across restarts and match what the JWT carries.
 */
import type { PaginationOptions, PaginatedResult } from '@proctira/common';
import { PgDocumentCollection, type PgPoolWithConnect, type PgQueryable } from '@proctira/database';

import type { BuiltInRoleSeed } from './in-memory-roles-repository.js';
import type {
  RoleEntity,
  RolesRepository,
  UserListFilter,
  UserRecord,
} from './roles-repository.js';

type RoleDoc = Omit<RoleEntity, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

function toEntity(doc: RoleDoc): RoleEntity {
  return {
    ...doc,
    permissions: doc.permissions.map((p) => ({ ...p })),
    createdAt: new Date(doc.createdAt),
    updatedAt: new Date(doc.updatedAt),
  };
}

function toDoc(entity: RoleEntity): RoleDoc {
  return {
    ...entity,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export class PgRolesRepository implements RolesRepository {
  private readonly roles: PgDocumentCollection<RoleDoc>;
  private readonly users: PgDocumentCollection<UserRecord>;
  private readonly seeded = new Set<string>();

  constructor(
    pool: PgPoolWithConnect | PgQueryable,
    private readonly seed: BuiltInRoleSeed[] = [],
  ) {
    this.roles = new PgDocumentCollection<RoleDoc>(pool, 'tenant.roles');
    this.users = new PgDocumentCollection<UserRecord>(pool, 'tenant.users');
  }

  private async ensureSeeded(tenantId: string): Promise<void> {
    if (this.seeded.has(tenantId)) return;
    const existing = await this.roles.byTenant(tenantId);
    if (existing.length === 0) {
      const now = new Date().toISOString();
      for (const def of this.seed) {
        const id = `${tenantId}::${def.roleId}`;
        await this.roles.put(
          id,
          {
            id,
            tenantId,
            roleId: def.roleId,
            name: def.roleName,
            description: null,
            builtIn: true,
            permissions: def.permissions.map((p) => ({ ...p })),
            createdAt: now,
            updatedAt: now,
          },
          tenantId,
        );
      }
    }
    this.seeded.add(tenantId);
  }

  // ─── Roles ────────────────────────────────────────────────────────────

  async listRoles(tenantId: string): Promise<RoleEntity[]> {
    await this.ensureSeeded(tenantId);
    const docs = await this.roles.byTenant(tenantId);
    return docs.map(toEntity).sort((a, b) => a.name.localeCompare(b.name));
  }

  async findRoleById(tenantId: string, id: string): Promise<RoleEntity | null> {
    await this.ensureSeeded(tenantId);
    const doc = await this.roles.get(id);
    return doc && doc.tenantId === tenantId ? toEntity(doc) : null;
  }

  async findRoleByName(tenantId: string, name: string): Promise<RoleEntity | null> {
    const lower = name.trim().toLowerCase();
    const roles = await this.listRoles(tenantId);
    return roles.find((r) => r.name.toLowerCase() === lower) ?? null;
  }

  async createRole(data: Omit<RoleEntity, 'createdAt' | 'updatedAt'>): Promise<RoleEntity> {
    await this.ensureSeeded(data.tenantId);
    const now = new Date();
    const entity: RoleEntity = { ...data, createdAt: now, updatedAt: now };
    await this.roles.put(entity.id, toDoc(entity), entity.tenantId);
    return entity;
  }

  async updateRole(
    tenantId: string,
    id: string,
    data: Partial<Omit<RoleEntity, 'id' | 'tenantId' | 'builtIn' | 'createdAt' | 'updatedAt'>>,
  ): Promise<RoleEntity | null> {
    const existing = await this.findRoleById(tenantId, id);
    if (!existing) return null;
    const next: RoleEntity = {
      ...existing,
      ...data,
      permissions: data.permissions
        ? data.permissions.map((p) => ({ ...p }))
        : existing.permissions,
      updatedAt: new Date(),
    };
    await this.roles.put(id, toDoc(next), tenantId);
    return next;
  }

  async deleteRole(tenantId: string, id: string): Promise<boolean> {
    const existing = await this.findRoleById(tenantId, id);
    if (!existing) return false;
    await this.roles.delete(id);
    const users = await this.users.byTenant(tenantId);
    for (const user of users) {
      if (user.roleIds.includes(id)) {
        await this.users.put(
          user.id,
          { ...user, roleIds: user.roleIds.filter((r) => r !== id) },
          tenantId,
        );
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
    let rows = await this.users.byTenant(tenantId);
    if (filter.search?.trim()) {
      const q = filter.search.trim().toLowerCase();
      rows = rows.filter(
        (u) => u.email.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q),
      );
    }
    if (filter.roleId) rows = rows.filter((u) => u.roleIds.includes(filter.roleId!));
    if (filter.status) rows = rows.filter((u) => u.status === filter.status);
    rows.sort((a, b) => a.displayName.localeCompare(b.displayName));

    const page = pagination.page ?? 1;
    const pageSize = pagination.pageSize ?? 20;
    const totalItems = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const offset = (page - 1) * pageSize;
    return {
      data: rows.slice(offset, offset + pageSize),
      meta: { page, pageSize, totalItems, totalPages },
    };
  }

  async findUserById(tenantId: string, id: string): Promise<UserRecord | null> {
    const user = await this.users.get(id);
    return user && user.tenantId === tenantId ? user : null;
  }

  async findUserByEmail(tenantId: string, email: string): Promise<UserRecord | null> {
    const lower = email.trim().toLowerCase();
    const rows = await this.users.byTenant(tenantId);
    return rows.find((u) => u.email.toLowerCase() === lower) ?? null;
  }

  async upsertUser(user: UserRecord): Promise<UserRecord> {
    return this.users.put(user.id, { ...user, roleIds: [...user.roleIds] }, user.tenantId);
  }

  async setUserRoles(
    tenantId: string,
    userId: string,
    roleIds: string[],
  ): Promise<UserRecord | null> {
    const existing = await this.findUserById(tenantId, userId);
    if (!existing) return null;
    return this.users.put(userId, { ...existing, roleIds: [...roleIds] }, tenantId);
  }
}
