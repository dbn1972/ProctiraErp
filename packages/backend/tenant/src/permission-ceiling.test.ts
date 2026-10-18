/**
 * PRC-L170 — delegated-permission ceiling (privilege-escalation guard).
 *
 * FAILING-FIRST: the `createRole` / `assignRolesToUser` / `updateRole` cases
 * below assert the service REJECTS a grant that exceeds the actor's own
 * effective permissions. On the unmodified service (which ignores the actor)
 * every grant succeeds, so these cases fail — exactly the escalation the
 * finding describes. After the ceiling is enforced they pass.
 *
 * Unit coverage of the pure predicate (`permissionCovers`) is included so the
 * wildcard/manage semantics are pinned independently of the service wiring.
 */
import { describe, expect, it } from 'vitest';

import { ValidationError } from '@proctira/common';

import { InMemoryRolesRepository, type BuiltInRoleSeed } from './in-memory-roles-repository.js';
import { permissionCovers } from './permission-ceiling.js';
import type { PermissionRef } from './roles-repository.js';
import { RolesService } from './roles-service.js';

const BUILT_IN_SEED: BuiltInRoleSeed[] = [
  {
    roleId: 'super-admin',
    roleName: 'Super Administrator',
    permissions: [{ resource: '*', action: 'manage' }],
  },
  {
    roleId: 'admin',
    roleName: 'Administrator',
    permissions: [
      { resource: 'institution', action: 'manage' },
      { resource: 'student', action: 'manage' },
    ],
  },
];

const TENANT = 'tenant-a';

function setup() {
  const repo = new InMemoryRolesRepository(BUILT_IN_SEED);
  repo.seedUsers(TENANT, [
    {
      id: 'user-1',
      tenantId: TENANT,
      email: 'alice@example.test',
      displayName: 'Alice Admin',
      roleIds: [],
      status: 'ACTIVE',
    },
  ]);
  const service = new RolesService(repo);
  return { repo, service };
}

/** A user-manager actor: holds `user:manage` only. */
const USER_MANAGER: PermissionRef[] = [{ resource: 'user', action: 'manage' }];
/** A superadmin actor: holds the wildcard. */
const SUPERADMIN: PermissionRef[] = [{ resource: '*', action: 'manage' }];

describe('permissionCovers (PRC-L170 predicate)', () => {
  it('matches rbac.ts roleHasPermission wildcard/manage semantics', () => {
    // `*:manage` covers everything.
    expect(permissionCovers(SUPERADMIN, { resource: 'anything', action: 'delete' })).toBe(true);
    expect(permissionCovers(SUPERADMIN, { resource: '*', action: 'manage' })).toBe(true);

    // `user:manage` covers every action on `user`, nothing else.
    expect(permissionCovers(USER_MANAGER, { resource: 'user', action: 'read' })).toBe(true);
    expect(permissionCovers(USER_MANAGER, { resource: 'user', action: 'delete' })).toBe(true);
    expect(permissionCovers(USER_MANAGER, { resource: 'student', action: 'read' })).toBe(false);
    expect(permissionCovers(USER_MANAGER, { resource: '*', action: 'manage' })).toBe(false);

    // A non-manage action only covers the exact pair.
    const reader: PermissionRef[] = [{ resource: 'student', action: 'read' }];
    expect(permissionCovers(reader, { resource: 'student', action: 'read' })).toBe(true);
    expect(permissionCovers(reader, { resource: 'student', action: 'update' })).toBe(false);
  });
});

describe('RolesService permission ceiling (PRC-L170)', () => {
  it('rejects creating a role that grants *:manage for a non-superadmin actor', async () => {
    const { service } = setup();
    await expect(
      service.createRole(
        TENANT,
        { name: 'Escalator', permissions: [{ resource: '*', action: 'manage' }] },
        { actorPermissions: USER_MANAGER },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects creating a role that grants a resource the actor lacks', async () => {
    const { service } = setup();
    await expect(
      service.createRole(
        TENANT,
        { name: 'Sneaky', permissions: [{ resource: 'student', action: 'read' }] },
        { actorPermissions: USER_MANAGER },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows creating a role within the actor ceiling', async () => {
    const { service } = setup();
    const role = await service.createRole(
      TENANT,
      { name: 'User Reader', permissions: [{ resource: 'user', action: 'read' }] },
      { actorPermissions: USER_MANAGER },
    );
    expect(role.permissions).toEqual([{ resource: 'user', action: 'read' }]);
  });

  it('allows a superadmin actor to grant anything', async () => {
    const { service } = setup();
    const role = await service.createRole(
      TENANT,
      { name: 'Clone', permissions: [{ resource: '*', action: 'manage' }] },
      { actorPermissions: SUPERADMIN },
    );
    expect(role.permissions).toEqual([{ resource: '*', action: 'manage' }]);
  });

  it('rejects updateRole adding a permission the actor lacks', async () => {
    const { service } = setup();
    const role = await service.createRole(
      TENANT,
      { name: 'Grower', permissions: [{ resource: 'user', action: 'read' }] },
      { actorPermissions: USER_MANAGER },
    );
    await expect(
      service.updateRole(
        TENANT,
        role.id,
        { permissions: [{ resource: 'student', action: 'manage' }] },
        { actorPermissions: USER_MANAGER },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects updateRolePermissions beyond the actor ceiling', async () => {
    const { service } = setup();
    const role = await service.createRole(
      TENANT,
      { name: 'Perms', permissions: [{ resource: 'user', action: 'read' }] },
      { actorPermissions: USER_MANAGER },
    );
    await expect(
      service.updateRolePermissions(
        TENANT,
        role.id,
        [{ resource: '*', action: 'manage' }],
        { actorPermissions: USER_MANAGER },
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects assigning a role that grants more than the actor holds', async () => {
    const { repo, service } = setup();
    // A privileged role exists in the tenant (seeded admin grants institution:manage).
    const adminRole = (await repo.listRoles(TENANT)).find((r) => r.roleId === 'admin')!;
    await expect(
      service.assignRolesToUser(TENANT, 'user-1', [adminRole.id], {
        actorPermissions: USER_MANAGER,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows assigning a role within the actor ceiling', async () => {
    const { repo, service } = setup();
    const userRole = await service.createRole(
      TENANT,
      { name: 'User Reader', permissions: [{ resource: 'user', action: 'read' }] },
      { actorPermissions: USER_MANAGER },
    );
    const updated = await service.assignRolesToUser(TENANT, 'user-1', [userRole.id], {
      actorPermissions: USER_MANAGER,
    });
    expect(updated.roleIds).toContain(userRole.id);
    // Sanity: repo untouched by the earlier read.
    expect(await repo.findRoleById(TENANT, userRole.id)).not.toBeNull();
  });

  it('keeps current behaviour when no actor is supplied (back-compat)', async () => {
    const { service } = setup();
    const role = await service.createRole(TENANT, {
      name: 'Legacy',
      permissions: [{ resource: '*', action: 'manage' }],
    });
    expect(role.permissions).toEqual([{ resource: '*', action: 'manage' }]);
  });
});
