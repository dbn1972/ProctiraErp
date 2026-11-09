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
import {
  canonicalizeDocumentTenantId,
  PgDocumentCollection,
  withPgTenant,
  withPlatformScope,
  type PgPoolWithConnect,
  type PgQueryable,
} from '@proctira/database';

import type { BuiltInRoleSeed } from './in-memory-roles-repository.js';
import type {
  RoleEntity,
  RolesRepository,
  UserListFilter,
  UserQuery,
  UserQueryWindow,
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

/** PRC-M026: JSON keys of the matchable user attributes (fixed; never user input). */
const PG_USER_ATTRIBUTE = {
  email: 'email',
  externalId: 'externalId',
  displayName: 'displayName',
} as const satisfies Record<Exclude<NonNullable<UserQuery['match']>['attribute'], 'id'>, string>;

export class PgRolesRepository implements RolesRepository {
  private readonly roles: PgDocumentCollection<RoleDoc>;
  private readonly users: PgDocumentCollection<UserRecord>;
  /**
   * PRC-L371: per-tenant uniqueness guards keyed on a derived name/e-mail id.
   * `insertIfAbsent` on these collections is the atomic conditional write that
   * lets two concurrent create/invite calls agree on a single winner.
   */
  private readonly roleNameGuards: PgDocumentCollection<{ roleId: string }>;
  private readonly userEmailGuards: PgDocumentCollection<{ userId: string }>;
  private readonly seeded = new Set<string>();

  constructor(
    private readonly pool: PgPoolWithConnect | PgQueryable,
    private readonly seed: BuiltInRoleSeed[] = [],
  ) {
    this.roles = new PgDocumentCollection<RoleDoc>(pool, 'tenant.roles');
    this.users = new PgDocumentCollection<UserRecord>(pool, 'tenant.users');
    this.roleNameGuards = new PgDocumentCollection<{ roleId: string }>(pool, 'tenant.role_names');
    this.userEmailGuards = new PgDocumentCollection<{ userId: string }>(pool, 'tenant.user_emails');
  }

  private roleNameGuardId(tenantId: string, name: string): string {
    return `${tenantId}::name::${name.trim().toLowerCase()}`;
  }

  private userEmailGuardId(tenantId: string, email: string): string {
    return `${tenantId}::email::${email.trim().toLowerCase()}`;
  }

  private async ensureSeeded(tenantId: string): Promise<void> {
    if (this.seeded.has(tenantId)) return;
    // PRC-L371: seed each built-in via `insertIfAbsent` keyed on the stable
    // `${tenantId}::${roleId}` id, so a concurrent first-access cannot
    // double-seed (the previous byTenant-empty-then-loop-put had a check-then
    // -insert race). Each insert is an atomic ON CONFLICT DO NOTHING.
    const now = new Date().toISOString();
    for (const def of this.seed) {
      const id = `${tenantId}::${def.roleId}`;
      await this.roles.insertIfAbsent(
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
    const doc = await this.roles.get(id, { tenantId });
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

  /**
   * PRC-L371: reserve the name atomically via the guard collection's
   * `INSERT … ON CONFLICT DO NOTHING`. Only the first concurrent caller's id
   * survives in the guard; a loser sees the winner's id and returns `null`
   * instead of double-inserting a same-named role.
   */
  async createRoleIfNameAbsent(
    data: Omit<RoleEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<RoleEntity | null> {
    await this.ensureSeeded(data.tenantId);
    const guardId = this.roleNameGuardId(data.tenantId, data.name);
    const winner = await this.roleNameGuards.insertIfAbsent(
      guardId,
      { roleId: data.id },
      data.tenantId,
    );
    if (winner.roleId !== data.id) return null;
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
    await this.roles.delete(id, { tenantId });
    // PRC-L371: release the name guard (idempotent) so the name can be reused.
    await this.roleNameGuards.delete(this.roleNameGuardId(tenantId, existing.name), { tenantId });
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

  /**
   * PRC-M026: the SCIM filter and window run in SQL on the tenant-bound
   * connection (RLS on control_plane_documents), so one lookup or one page
   * never loads the tenant's whole directory into the gateway.
   */
  async queryUsers(
    tenantId: string,
    query: UserQuery,
    window: UserQueryWindow,
  ): Promise<{ data: UserRecord[]; total: number }> {
    const owner = canonicalizeDocumentTenantId(tenantId);
    const params: unknown[] = [owner];
    const where = [`collection = 'tenant.users'`, `tenant_id = $1`];
    if (query.roleId) {
      params.push(query.roleId);
      where.push(`(data->'roleIds') ? $${params.length}`);
    }
    if (query.match) {
      params.push(query.match.value);
      const column =
        query.match.attribute === 'id'
          ? 'id'
          : `COALESCE(data->>'${PG_USER_ATTRIBUTE[query.match.attribute]}', '')`;
      where.push(`lower(${column}) = lower($${params.length})`);
    }
    params.push(Math.max(0, Math.trunc(window.limit)), Math.max(0, Math.trunc(window.offset)));
    const sql = `SELECT data, COUNT(*) OVER () AS total
                   FROM control_plane_documents
                  WHERE ${where.join(' AND ')}
                  ORDER BY data->>'displayName' ASC, id ASC
                  LIMIT $${params.length - 1} OFFSET $${params.length}`;
    return withPgTenant(this.pool, owner, async (client) => {
      const res = await client.query(sql, params);
      const rows = res.rows as Array<{ data: UserRecord; total: string | number }>;
      if (rows.length > 0) {
        return {
          data: rows.map((r) => ({ ...r.data, roleIds: [...(r.data.roleIds ?? [])] })),
          total: Number(rows[0]!.total),
        };
      }
      if (window.offset <= 0) return { data: [], total: 0 };
      // A window past the end still reports the real total.
      const count = await client.query(
        `SELECT COUNT(*)::int AS total FROM control_plane_documents WHERE ${where.join(' AND ')}`,
        params.slice(0, -2),
      );
      return { data: [], total: Number((count.rows[0] as { total: number }).total) };
    });
  }

  async findUserById(tenantId: string, id: string): Promise<UserRecord | null> {
    const user = await this.users.get(id, { tenantId });
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

  /**
   * PRC-L371: reserve the e-mail atomically via the guard collection, then
   * write the user. A concurrent invite for the same e-mail loses the guard
   * race and returns `null` rather than creating a second record.
   */
  async insertUserIfEmailAbsent(user: UserRecord): Promise<UserRecord | null> {
    const guardId = this.userEmailGuardId(user.tenantId, user.email);
    const winner = await this.userEmailGuards.insertIfAbsent(
      guardId,
      { userId: user.id },
      user.tenantId,
    );
    if (winner.userId !== user.id) return null;
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

  /** PRC-M026: `SELECT … FOR UPDATE` serialises concurrent membership changes per user. */
  async updateUserRolesAtomic(
    tenantId: string,
    userId: string,
    mutate: (current: string[]) => string[],
  ): Promise<{ before: string[]; user: UserRecord } | null> {
    return withPlatformScope(
      this.pool,
      async (client) => {
        const res = await client.query(
          `SELECT data FROM control_plane_documents
            WHERE collection = 'tenant.users' AND id = $1 AND tenant_id = $2
            FOR UPDATE`,
          [userId, tenantId],
        );
        const current = (res.rows[0] as { data?: UserRecord } | undefined)?.data;
        if (!current || current.tenantId !== tenantId) return null;
        const before = [...(current.roleIds ?? [])];
        const user: UserRecord = { ...current, roleIds: [...new Set(mutate([...before]))] };
        await client.query(
          `UPDATE control_plane_documents SET data = $3::jsonb, updated_at = now()
            WHERE collection = 'tenant.users' AND id = $1 AND tenant_id = $2`,
          [userId, tenantId, JSON.stringify(user)],
        );
        return { before, user };
      },
      tenantId,
    );
  }
}
