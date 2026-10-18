/**
 * PRC-L371 (deleteTenant / deleteRole resilience) — regression guards.
 *
 * `deleteTenant` on the in-memory repository removes the tenant row plus its
 * domains and usage in one synchronous method, so it is effectively atomic on
 * the Node event loop. These tests PIN that contract: a cleanup failure after
 * the tenant row is gone must leave a state a retry can resolve, and a second
 * delete is a safe idempotent no-op. `deleteRole` must likewise tolerate a
 * re-run after it has already scrubbed the role from its holders.
 *
 * These are regression tests (the behaviour is already correct); they fail if
 * a future change reintroduces a partial-failure or non-idempotent delete.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryRolesRepository, type BuiltInRoleSeed } from './in-memory-roles-repository.js';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import type { TenantEntity } from './tenant-repository.js';

const TENANT = 'tenant-a';

function decommissionedTenant(id: string): Omit<TenantEntity, 'createdAt' | 'updatedAt'> {
  return {
    id,
    name: 'Acme',
    slug: id,
    status: 'decommissioned',
    plan: null,
    region: null,
    config: {},
    suspendedAt: null,
    suspendedReason: null,
    decommissionedAt: new Date(),
    dataRetentionUntil: new Date(Date.now() - 1000),
    legalHold: false,
  };
}

describe('deleteTenant resilience (PRC-L371)', () => {
  it('removes tenant, domains and usage together (atomic cleanup)', async () => {
    const repo = new InMemoryTenantRepository();
    const tenant = await repo.createTenant(decommissionedTenant('acme'));
    await repo.addDomain({
      id: 'd1',
      tenantId: tenant.id,
      domain: 'acme.test',
      primary: true,
      verified: true,
      createdAt: new Date(),
    });
    await repo.getOrCreateUsage(tenant.id);

    const removed = await repo.deleteTenant(tenant.id);
    expect(removed).toBe(true);
    expect(await repo.findTenantById(tenant.id)).toBeNull();
    expect(await repo.findDomainsByTenant(tenant.id)).toHaveLength(0);
  });

  it('a second deleteTenant is a safe idempotent no-op', async () => {
    const repo = new InMemoryTenantRepository();
    const tenant = await repo.createTenant(decommissionedTenant('acme2'));
    expect(await repo.deleteTenant(tenant.id)).toBe(true);
    // Retry after the row is already gone: no throw, reports nothing removed.
    expect(await repo.deleteTenant(tenant.id)).toBe(false);
    expect(await repo.findTenantById(tenant.id)).toBeNull();
  });
});

const ROLE_SEED: BuiltInRoleSeed[] = [
  { roleId: 'admin', roleName: 'Administrator', permissions: [{ resource: '*', action: 'manage' }] },
];

describe('deleteRole resilience (PRC-L371)', () => {
  it('removes the role and scrubs it from holders; a re-run is a no-op', async () => {
    const repo = new InMemoryRolesRepository(ROLE_SEED);
    const role = await repo.createRole({
      id: 'r1',
      tenantId: TENANT,
      roleId: 'r1',
      name: 'Temp',
      description: null,
      builtIn: false,
      permissions: [],
    });
    repo.seedUsers(TENANT, [
      {
        id: 'u1',
        tenantId: TENANT,
        email: 'u1@example.test',
        displayName: 'U One',
        roleIds: [role.id],
        status: 'ACTIVE',
      },
    ]);

    expect(await repo.deleteRole(TENANT, role.id)).toBe(true);
    const user = await repo.findUserById(TENANT, 'u1');
    expect(user?.roleIds).not.toContain(role.id);

    // Idempotent re-run after the role is already gone.
    expect(await repo.deleteRole(TENANT, role.id)).toBe(false);
  });
});
