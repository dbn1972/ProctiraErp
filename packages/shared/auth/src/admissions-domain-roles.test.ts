/**
 * UATENV-D19 — the registrar reads and processes admissions, shared by the
 * gateway and web RBAC registries; school-structure lookup reads are a
 * separate, gateway-only grant.
 */
import { describe, expect, it } from 'vitest';

import {
  ADMISSIONS_DOMAIN_ROLE_GRANTS,
  ADMISSIONS_LOOKUP_GRANTS,
  ADMISSIONS_STAFF_ROLE_IDS,
  applyAdmissionsDomainRoleGrants,
  applyAdmissionsLookupReadGrants,
} from './admissions-domain-roles.js';
import { RbacPermissionRegistry, type PermissionAction, type RoleDefinition } from './rbac.js';

const ACTIONS: PermissionAction[] = ['read', 'list', 'create', 'update', 'delete', 'manage'];

describe('admissions domain role grants (UATENV-D19)', () => {
  it('names only the registrar', () => {
    expect([...ADMISSIONS_STAFF_ROLE_IDS]).toEqual(['registrar']);
    expect(ADMISSIONS_DOMAIN_ROLE_GRANTS.map((g) => g.roleId)).toEqual(['registrar']);
    expect(ADMISSIONS_LOOKUP_GRANTS.map((g) => g.roleId)).toEqual(['registrar']);
  });

  it('grants the registrar registration read/list/create/update and nothing else', () => {
    const registry = new RbacPermissionRegistry(applyAdmissionsDomainRoleGrants([]));
    const allowed: PermissionAction[] = ['read', 'list', 'create', 'update'];
    for (const action of ACTIONS) {
      expect(registry.roleHasPermission('registrar', 'registration', action), action).toBe(
        allowed.includes(action),
      );
    }
    for (const permission of registry.getRole('registrar')!.permissions) {
      expect(permission.resource).toBe('registration');
    }
    expect(registry.roleHasPermission('registrar', 'institution', 'read')).toBe(false);
    expect(registry.roleHasPermission('registrar', 'fees', 'read')).toBe(false);
  });

  it('keeps the lookup grant to institution read/list', () => {
    const registry = new RbacPermissionRegistry(applyAdmissionsLookupReadGrants([]));
    for (const action of ACTIONS) {
      expect(registry.roleHasPermission('registrar', 'institution', action), action).toBe(
        action === 'read' || action === 'list',
      );
    }
    for (const permission of registry.getRole('registrar')!.permissions) {
      expect(permission.resource).toBe('institution');
    }
    expect(registry.roleHasPermission('registrar', 'registration', 'read')).toBe(false);
  });

  it('appends to an existing registrar without dropping its permissions', () => {
    const roles: RoleDefinition[] = [
      {
        roleId: 'registrar',
        roleName: 'Registrar',
        permissions: [
          { resource: 'staff', action: 'manage' },
          { resource: 'fees', action: 'read' },
        ],
      },
    ];
    const registry = new RbacPermissionRegistry(applyAdmissionsDomainRoleGrants(roles));
    expect(registry.roleHasPermission('registrar', 'staff', 'manage')).toBe(true);
    expect(registry.roleHasPermission('registrar', 'fees', 'read')).toBe(true);
    expect(registry.roleHasPermission('registrar', 'registration', 'update')).toBe(true);
    expect(registry.roleHasPermission('registrar', 'fees', 'create')).toBe(false);
  });

  it('is idempotent and copies permission objects', () => {
    const roles = applyAdmissionsDomainRoleGrants(applyAdmissionsDomainRoleGrants([]));
    expect(roles).toHaveLength(1);
    expect(roles[0]!.permissions).toHaveLength(4);
    roles[0]!.permissions.push({ resource: 'student', action: 'manage' });
    const fresh = new RbacPermissionRegistry(applyAdmissionsDomainRoleGrants([]));
    expect(fresh.roleHasPermission('registrar', 'student', 'manage')).toBe(false);
  });
});
