/**
 * F-D3 — one least-privilege fees grant matrix for the finance roles,
 * applied by both the gateway and the web RBAC registries.
 */
import { describe, expect, it } from 'vitest';
import {
  applyFeesDomainRoleGrants,
  FEES_BASE_READ_ROLE_IDS,
  FEES_DOMAIN_ROLE_GRANTS,
  FEES_READ_ONLY_ROLE_IDS,
  FEES_STAFF_ROLE_IDS,
} from './fees-domain-roles.js';
import { RbacPermissionRegistry, type PermissionAction, type RoleDefinition } from './rbac.js';

const ACTIONS: PermissionAction[] = ['read', 'list', 'create', 'update', 'delete', 'manage'];

/** The F-D3 matrix: role → allowed gateway actions on `fees`. */
function expected(roleId: string): PermissionAction[] {
  if (['finance_officer', 'bursar', 'accountant'].includes(roleId)) {
    return ['read', 'list', 'create', 'delete'];
  }
  if (roleId === 'registrar') return ['read', 'list'];
  return [];
}

function registryFor(roles: RoleDefinition[]): RbacPermissionRegistry {
  return new RbacPermissionRegistry(applyFeesDomainRoleGrants(roles));
}

describe('fees domain role grants (F-D3)', () => {
  it('lists the finance roles, the read-only registrar and the gateway base readers', () => {
    expect([...FEES_STAFF_ROLE_IDS]).toEqual(['finance_officer', 'bursar', 'accountant']);
    expect([...FEES_READ_ONLY_ROLE_IDS]).toEqual(['registrar']);
    expect([...FEES_BASE_READ_ROLE_IDS]).toEqual([
      'teacher',
      'staff',
      'guardian',
      'parent',
      'student',
    ]);
  });

  it('grants each role exactly its matrix actions on fees and nothing else', () => {
    const registry = registryFor([]);
    for (const roleId of ['finance_officer', 'bursar', 'accountant', 'registrar']) {
      const allowed = expected(roleId);
      for (const action of ACTIONS) {
        expect(registry.roleHasPermission(roleId, 'fees', action), `${roleId} fees:${action}`).toBe(
          allowed.includes(action),
        );
      }
      const role = registry.getRole(roleId);
      expect(role, roleId).toBeDefined();
      for (const permission of role!.permissions) {
        expect(permission.resource, `${roleId} ${permission.resource}`).toBe('fees');
        expect(permission.action).not.toBe('manage');
      }
    }
  });

  it('declares one entry per role id', () => {
    const ids = FEES_DOMAIN_ROLE_GRANTS.map((grant) => grant.roleId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(['accountant', 'bursar', 'finance_officer', 'registrar']);
  });

  it('appends to an existing role without dropping its permissions', () => {
    const roles: RoleDefinition[] = [
      {
        roleId: 'registrar',
        roleName: 'Registrar',
        permissions: [
          { resource: 'staff', action: 'manage' },
          { resource: 'hostel', action: 'read' },
        ],
      },
    ];
    const registry = registryFor(roles);
    expect(registry.roleHasPermission('registrar', 'staff', 'manage')).toBe(true);
    expect(registry.roleHasPermission('registrar', 'hostel', 'read')).toBe(true);
    expect(registry.roleHasPermission('registrar', 'fees', 'read')).toBe(true);
    expect(registry.roleHasPermission('registrar', 'fees', 'create')).toBe(false);
    expect(registry.getRole('registrar')!.roleName).toBe('Registrar');
  });

  it('is idempotent and does not share permission objects between registries', () => {
    const roles = applyFeesDomainRoleGrants(applyFeesDomainRoleGrants([]));
    const bursar = roles.find((role) => role.roleId === 'bursar')!;
    expect(bursar.permissions).toHaveLength(4);
    expect(roles.filter((role) => role.roleId === 'bursar')).toHaveLength(1);
    bursar.permissions.push({ resource: 'student', action: 'manage' });
    const fresh = registryFor([]);
    expect(fresh.roleHasPermission('bursar', 'student', 'manage')).toBe(false);
  });

  it('gives teacher, staff and the portal roles nothing', () => {
    const registry = registryFor([]);
    for (const roleId of ['teacher', 'staff', 'student', 'parent', 'guardian', 'fees_clerk']) {
      expect(registry.getRole(roleId), roleId).toBeUndefined();
    }
  });
});
