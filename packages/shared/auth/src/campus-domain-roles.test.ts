/**
 * H-D2 / T-O1 / H-D1-R5 — one least-privilege grant matrix for hostel and
 * transport staff, applied by both the gateway and the web RBAC registries.
 */
import { describe, expect, it } from 'vitest';
import {
  applyCampusDomainRoleGrants,
  CAMPUS_BASE_READ_ROLE_IDS,
  CAMPUS_DOMAIN_ROLE_GRANTS,
  CAMPUS_READ_ONLY_ROLE_IDS,
  HOSTEL_STAFF_ROLE_IDS,
  TRANSPORT_STAFF_ROLE_IDS,
} from './campus-domain-roles.js';
import { RbacPermissionRegistry, type PermissionAction, type RoleDefinition } from './rbac.js';

const ACTIONS: PermissionAction[] = ['read', 'list', 'create', 'update', 'delete', 'manage'];

const HOSTEL_STAFF = [
  'warden',
  'hostel_warden',
  'hostel-warden',
  'hostel_manager',
  'hostel-manager',
  'hostel_admin',
  'hostel-admin',
  'hostel_clerk',
];
const TRANSPORT_STAFF = [
  'transport_officer',
  'transport-officer',
  'transport_manager',
  'transport-manager',
  'fleet_manager',
  'fleet-manager',
  'transport_admin',
  'transport-admin',
];

/** The matrix from the PR-1 plan: role → resource → allowed actions. */
function expected(roleId: string, resource: 'hostel' | 'transport'): PermissionAction[] {
  if (HOSTEL_STAFF.includes(roleId)) {
    return resource === 'hostel' ? ['read', 'list', 'create', 'update'] : [];
  }
  if (TRANSPORT_STAFF.includes(roleId)) {
    return resource === 'transport' ? ['read', 'list', 'create', 'update', 'delete'] : [];
  }
  if (roleId === 'registrar') return ['read', 'list'];
  return [];
}

function registryFor(roles: RoleDefinition[]): RbacPermissionRegistry {
  return new RbacPermissionRegistry(applyCampusDomainRoleGrants(roles));
}

describe('campus domain role grants (H-D2, T-O1)', () => {
  it('lists the package staff roles in both spellings', () => {
    expect([...HOSTEL_STAFF_ROLE_IDS]).toEqual(HOSTEL_STAFF);
    expect([...TRANSPORT_STAFF_ROLE_IDS]).toEqual(TRANSPORT_STAFF);
    expect([...CAMPUS_READ_ONLY_ROLE_IDS]).toEqual(['registrar']);
    expect([...CAMPUS_BASE_READ_ROLE_IDS]).toEqual(['teacher', 'staff', 'student']);
  });

  it('grants each role exactly its matrix actions and nothing else', () => {
    const registry = registryFor([]);
    for (const roleId of [...HOSTEL_STAFF, ...TRANSPORT_STAFF, 'registrar']) {
      for (const resource of ['hostel', 'transport'] as const) {
        const allowed = expected(roleId, resource);
        for (const action of ACTIONS) {
          expect(
            registry.roleHasPermission(roleId, resource, action),
            `${roleId} ${resource}:${action}`,
          ).toBe(allowed.includes(action));
        }
      }
      const role = registry.getRole(roleId);
      expect(role, roleId).toBeDefined();
      for (const permission of role!.permissions) {
        expect(['hostel', 'transport'], `${roleId} ${permission.resource}`).toContain(
          permission.resource,
        );
        expect(permission.resource).not.toBe('*');
        expect(permission.action).not.toBe('manage');
      }
    }
  });

  it('declares one entry per role id', () => {
    const ids = CAMPUS_DOMAIN_ROLE_GRANTS.map((grant) => grant.roleId);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...HOSTEL_STAFF, ...TRANSPORT_STAFF, 'registrar'].sort());
  });

  it('appends to an existing role without dropping its permissions', () => {
    const roles: RoleDefinition[] = [
      {
        roleId: 'registrar',
        roleName: 'Registrar',
        permissions: [{ resource: 'staff', action: 'manage' }],
      },
    ];
    const registry = registryFor(roles);
    expect(registry.roleHasPermission('registrar', 'staff', 'manage')).toBe(true);
    expect(registry.roleHasPermission('registrar', 'hostel', 'read')).toBe(true);
    expect(registry.roleHasPermission('registrar', 'transport', 'create')).toBe(false);
    expect(registry.getRole('registrar')!.roleName).toBe('Registrar');
  });

  it('is idempotent and does not share permission objects between registries', () => {
    const roles = applyCampusDomainRoleGrants(applyCampusDomainRoleGrants([]));
    const warden = roles.find((role) => role.roleId === 'warden')!;
    expect(warden.permissions).toHaveLength(4);
    expect(roles.filter((role) => role.roleId === 'warden')).toHaveLength(1);
    warden.permissions.push({ resource: 'student', action: 'manage' });
    const fresh = registryFor([]);
    expect(fresh.roleHasPermission('warden', 'student', 'manage')).toBe(false);
  });

  it('gives teacher, staff, student, parent and guardian nothing', () => {
    const registry = registryFor([]);
    for (const roleId of ['teacher', 'staff', 'student', 'parent', 'guardian', 'nurse']) {
      expect(registry.getRole(roleId), roleId).toBeUndefined();
    }
  });
});
