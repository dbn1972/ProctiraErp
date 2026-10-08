/**
 * PRC-H101 — tenant custom roles must feed gateway authorization: a token
 * carrying a tenant's custom role id is evaluated against that role's
 * permissions, built-in roles stay immutable, and an edit changes allow/deny
 * (cached with a short TTL + invalidation).
 */
import { evaluatePermission, InMemoryAreaHierarchyResolver } from '@proctira/backend-auth';
import type { PaginatedResult, PaginationOptions } from '@proctira/common';
import type {
  RoleEntity,
  RolesRepository,
  UserListFilter,
  UserRecord,
} from '@proctira/backend-tenant';
import { describe, expect, it } from 'vitest';

import { createGatewayRbacRegistry } from './rbac-registry.js';
import { TenantCustomRoleProvider } from './tenant-custom-roles.js';

const TENANT = 'tenant-1';
const resolver = new InMemoryAreaHierarchyResolver([]);

/** Minimal mutable RolesRepository stub exposing only listRoles. */
class StubRolesRepository implements RolesRepository {
  constructor(private rolesByTenant: Map<string, RoleEntity[]>) {}
  setRoles(tenantId: string, roles: RoleEntity[]) {
    this.rolesByTenant.set(tenantId, roles);
  }
  async listRoles(tenantId: string): Promise<RoleEntity[]> {
    return this.rolesByTenant.get(tenantId) ?? [];
  }
  // Unused by the provider — present to satisfy the interface.
  findRoleById = async (): Promise<RoleEntity | null> => null;
  findRoleByName = async (): Promise<RoleEntity | null> => null;
  createRole = async (d: Omit<RoleEntity, 'createdAt' | 'updatedAt'>): Promise<RoleEntity> => ({
    ...d,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  updateRole = async (): Promise<RoleEntity | null> => null;
  deleteRole = async (): Promise<boolean> => false;
  listUsers = async (
    _t: string,
    _f: UserListFilter,
    _p: PaginationOptions,
  ): Promise<PaginatedResult<UserRecord>> => ({
    data: [],
    meta: { page: 1, pageSize: 0, totalItems: 0, totalPages: 0 },
  });
  findUserById = async (): Promise<UserRecord | null> => null;
  findUserByEmail = async (): Promise<UserRecord | null> => null;
  upsertUser = async (u: UserRecord): Promise<UserRecord> => u;
  setUserRoles = async (): Promise<UserRecord | null> => null;
}

function customRole(roleId: string, permissions: RoleEntity['permissions']): RoleEntity {
  return {
    id: `${TENANT}::${roleId}`,
    tenantId: TENANT,
    roleId,
    name: roleId,
    description: null,
    builtIn: false,
    permissions,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function authUser(roleId: string) {
  return {
    userId: 'u1',
    tenantId: TENANT,
    email: 'u@x',
    displayName: 'U',
    roles: [{ roleId, roleName: roleId, areaId: 'ROOT' }],
    areas: [],
    institutions: [],
  };
}

const base = createGatewayRbacRegistry();
const builtInIds = new Set(base.getAllRoles().map((r) => r.roleId));

async function granted(provider: TenantCustomRoleProvider, roleId: string, resource: string) {
  const reg = await provider.registryForRequest(base, TENANT, [roleId]);
  const res = await evaluatePermission(authUser(roleId), resource, 'read', reg, resolver);
  return res.granted;
}

describe('PRC-H101 tenant custom roles feed gateway RBAC', () => {
  it('a custom role grants exactly its permissions', async () => {
    const repo = new StubRolesRepository(
      new Map([[TENANT, [customRole('counsellor_x', [{ resource: 'library', action: 'read' }])]]]),
    );
    const provider = new TenantCustomRoleProvider({ repository: repo, builtInRoleIds: builtInIds });
    expect(await granted(provider, 'counsellor_x', 'library')).toBe(true);
    expect(await granted(provider, 'counsellor_x', 'health')).toBe(false);
  });

  it('an edited custom role changes allow/deny after invalidation', async () => {
    const repo = new StubRolesRepository(
      new Map([[TENANT, [customRole('role_edit', [{ resource: 'library', action: 'read' }])]]]),
    );
    const provider = new TenantCustomRoleProvider({ repository: repo, builtInRoleIds: builtInIds });
    // Initially library:read is granted, health:read denied.
    expect(await granted(provider, 'role_edit', 'library')).toBe(true);
    expect(await granted(provider, 'role_edit', 'health')).toBe(false);

    // Edit the role to drop library and add health.
    repo.setRoles(TENANT, [customRole('role_edit', [{ resource: 'health', action: 'read' }])]);
    // Without invalidation the cached snapshot still answers the old way.
    expect(await granted(provider, 'role_edit', 'health')).toBe(false);
    // After invalidation the new permissions take effect.
    provider.invalidate(TENANT);
    expect(await granted(provider, 'role_edit', 'health')).toBe(true);
    expect(await granted(provider, 'role_edit', 'library')).toBe(false);
  });

  it('a custom role cannot override a built-in role id (admin stays immutable)', async () => {
    // A malicious tenant document reuses the built-in `admin` id with no perms.
    const repo = new StubRolesRepository(
      new Map([[TENANT, [{ ...customRole('admin', []), builtIn: false }]]]),
    );
    const provider = new TenantCustomRoleProvider({ repository: repo, builtInRoleIds: builtInIds });
    // admin is a built-in with student:manage — the empty custom doc must not strip it.
    const reg = await provider.registryForRequest(base, TENANT, ['admin']);
    expect(reg.roleHasPermission('admin', 'student', 'read')).toBe(true);
  });

  it('TTL expiry reloads the snapshot even without an explicit invalidation', async () => {
    let now = 1000;
    const repo = new StubRolesRepository(
      new Map([[TENANT, [customRole('ttl_role', [{ resource: 'library', action: 'read' }])]]]),
    );
    const provider = new TenantCustomRoleProvider({
      repository: repo,
      builtInRoleIds: builtInIds,
      ttlMs: 100,
      now: () => now,
    });
    expect(await granted(provider, 'ttl_role', 'library')).toBe(true);
    repo.setRoles(TENANT, [customRole('ttl_role', [{ resource: 'health', action: 'read' }])]);
    now += 200; // past the TTL
    expect(await granted(provider, 'ttl_role', 'health')).toBe(true);
    expect(await granted(provider, 'ttl_role', 'library')).toBe(false);
  });

  it('an unknown role id (no custom match) is denied — base registry unchanged', async () => {
    const repo = new StubRolesRepository(new Map());
    const provider = new TenantCustomRoleProvider({ repository: repo, builtInRoleIds: builtInIds });
    const reg = await provider.registryForRequest(base, TENANT, ['nonexistent']);
    expect(reg).toBe(base); // no custom role to merge
    expect(await granted(provider, 'nonexistent', 'library')).toBe(false);
  });
});
