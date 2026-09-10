/**
 * Roles Service unit tests (Task 59.3 / Requirement 42 AC 4–5).
 *
 * Validates:
 *   • Built-in roles seeded from the in-memory repo are read-only — update
 *     and delete throw `BusinessRuleError`.
 *   • Custom roles can be created, updated, and deleted, and every mutation
 *     emits an audit event marked `riskLevel: 'high'` (Requirement 33 AC 4).
 *   • Role-permission updates take effect on the next read because the
 *     repository is the source of truth (no caching).
 *   • User → role assignment validates that referenced roles exist and emits
 *     an audit event.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';

import { InMemoryRolesRepository, type BuiltInRoleSeed } from './in-memory-roles-repository.js';
import { RolesService, type RolesAuditEvent } from './roles-service.js';

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
    {
      id: 'user-2',
      tenantId: TENANT,
      email: 'bob@example.test',
      displayName: 'Bob Builder',
      roleIds: [],
      status: 'ACTIVE',
    },
  ]);
  const events: RolesAuditEvent[] = [];
  const service = new RolesService(repo, async (event) => {
    events.push(event);
  });
  return { repo, service, events };
}

describe('RolesService', () => {
  describe('listRoles + listPermissionCatalog', () => {
    it('seeds built-in roles per tenant from the repo seed', async () => {
      const { service } = setup();
      const roles = await service.listRoles(TENANT);
      expect(roles.map((r) => r.roleId).sort()).toEqual(['admin', 'super-admin']);
      expect(roles.every((r) => r.builtIn)).toBe(true);
    });

    it('produces a permission catalog covering every (resource, action) pair', async () => {
      const { service } = setup();
      const catalog = await service.listPermissionCatalog(TENANT);
      const keys = catalog.map((p) => `${p.resource}:${p.action}`).sort();
      expect(keys).toContain('*:manage');
      expect(keys).toContain('institution:manage');
      expect(keys).toContain('student:manage');
    });
  });

  describe('createRole', () => {
    it('creates a custom role and emits a high-risk CREATE audit event', async () => {
      const { service, events } = setup();
      const role = await service.createRole(TENANT, {
        name: 'Curriculum Lead',
        description: 'Cross-institution curriculum oversight',
        permissions: [
          { resource: 'assessment', action: 'manage' },
          { resource: 'report', action: 'read' },
        ],
      });

      expect(role.builtIn).toBe(false);
      expect(role.permissions).toHaveLength(2);

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event).toMatchObject({
        tenantId: TENANT,
        entityType: 'role',
        operation: 'CREATE',
        beforeValues: null,
      });
      expect(event.afterValues).toMatchObject({ name: 'Curriculum Lead' });
      expect(event.metadata.riskLevel).toBe('high');
    });

    it('rejects duplicate role names', async () => {
      const { service } = setup();
      await service.createRole(TENANT, {
        name: 'Curriculum Lead',
        permissions: [],
      });
      await expect(
        service.createRole(TENANT, {
          name: 'Curriculum Lead',
          permissions: [],
        }),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('rejects invalid actions', async () => {
      const { service } = setup();
      await expect(
        service.createRole(TENANT, {
          name: 'Bogus',
          // @ts-expect-error — exercising the validation path
          permissions: [{ resource: 'student', action: 'nuke' }],
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe('updateRole / updateRolePermissions', () => {
    it('blocks updates to built-in roles', async () => {
      const { service, repo } = setup();
      const builtIn = (await repo.listRoles(TENANT)).find((r) => r.builtIn)!;
      await expect(service.updateRolePermissions(TENANT, builtIn.id, [])).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
    });

    it('persists permission changes and emits a high-risk UPDATE event with full diff', async () => {
      const { service, events } = setup();
      const created = await service.createRole(TENANT, {
        name: 'Curriculum Lead',
        permissions: [{ resource: 'assessment', action: 'read' }],
      });
      events.length = 0;

      const updated = await service.updateRolePermissions(TENANT, created.id, [
        { resource: 'assessment', action: 'manage' },
        { resource: 'report', action: 'read' },
      ]);

      // Service returned the new shape.
      expect(updated.permissions).toHaveLength(2);
      // Repo reflects the change for subsequent reads — proving no caching.
      const refetched = await service.getRole(TENANT, created.id);
      expect(refetched.permissions).toHaveLength(2);

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.operation).toBe('UPDATE');
      expect(event.metadata.riskLevel).toBe('high');
      expect(event.metadata.change).toBe('role_permissions_changed');
      expect(event.beforeValues).toMatchObject({
        permissions: [{ resource: 'assessment', action: 'read' }],
      });
      expect(event.afterValues).toMatchObject({
        permissions: expect.arrayContaining([
          { resource: 'assessment', action: 'manage' },
          { resource: 'report', action: 'read' },
        ]),
      });
    });

    it('flags duplicate name conflicts', async () => {
      const { service } = setup();
      await service.createRole(TENANT, { name: 'Curriculum Lead', permissions: [] });
      const other = await service.createRole(TENANT, {
        name: 'Other Role',
        permissions: [],
      });
      await expect(
        service.updateRole(TENANT, other.id, { name: 'Curriculum Lead' }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('deleteRole', () => {
    it('deletes a custom role and emits a high-risk DELETE event', async () => {
      const { service, events } = setup();
      const role = await service.createRole(TENANT, {
        name: 'Disposable',
        permissions: [],
      });
      events.length = 0;

      await service.deleteRole(TENANT, role.id);

      await expect(service.getRole(TENANT, role.id)).rejects.toBeInstanceOf(NotFoundError);

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.operation).toBe('DELETE');
      expect(event.metadata.riskLevel).toBe('high');
    });

    it('rejects deletion of built-in roles', async () => {
      const { service, repo } = setup();
      const builtIn = (await repo.listRoles(TENANT)).find((r) => r.builtIn)!;
      await expect(service.deleteRole(TENANT, builtIn.id)).rejects.toBeInstanceOf(
        BusinessRuleError,
      );
    });
  });

  describe('assignRolesToUser', () => {
    it('replaces a user role set and emits a high-risk UPDATE event', async () => {
      const { service, events, repo } = setup();
      const role = await service.createRole(TENANT, {
        name: 'Curriculum Lead',
        permissions: [],
      });
      events.length = 0;

      const updated = await service.assignRolesToUser(TENANT, 'user-1', [role.id]);
      expect(updated.roleIds).toEqual([role.id]);

      // Repo backs the next request directly — proving permissions apply on
      // the next request without a cache.
      const refetched = await repo.findUserById(TENANT, 'user-1');
      expect(refetched?.roleIds).toEqual([role.id]);

      expect(events).toHaveLength(1);
      const event = events[0]!;
      expect(event.entityType).toBe('user');
      expect(event.operation).toBe('UPDATE');
      expect(event.metadata.riskLevel).toBe('high');
      expect(event.beforeValues).toEqual({ roleIds: [] });
      expect(event.afterValues).toEqual({ roleIds: [role.id] });
    });

    it('rejects assignments that reference unknown roles', async () => {
      const { service } = setup();
      await expect(
        service.assignRolesToUser(TENANT, 'user-1', ['no-such-role']),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws NotFoundError when the user does not exist', async () => {
      const { service } = setup();
      await expect(service.assignRolesToUser(TENANT, 'ghost-user', [])).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });

  describe('audit emitter contract', () => {
    it('always sets riskLevel="high" on every emitted event', async () => {
      const { service, events } = setup();
      const role = await service.createRole(TENANT, {
        name: 'Curriculum Lead',
        permissions: [],
      });
      await service.updateRolePermissions(TENANT, role.id, [
        { resource: 'assessment', action: 'read' },
      ]);
      await service.assignRolesToUser(TENANT, 'user-1', [role.id]);
      await service.deleteRole(TENANT, role.id);

      expect(events).toHaveLength(4);
      for (const event of events) {
        expect(event.metadata.riskLevel).toBe('high');
      }
    });

    it('treats audit emitter failures as fatal so the UI sees the error', async () => {
      const repo = new InMemoryRolesRepository(BUILT_IN_SEED);
      const fail = vi.fn(async () => {
        throw new Error('audit pipeline down');
      });
      const service = new RolesService(repo, fail);

      await expect(
        service.createRole(TENANT, {
          name: 'X',
          permissions: [],
        }),
      ).rejects.toThrow('audit pipeline down');
    });
  });
});
