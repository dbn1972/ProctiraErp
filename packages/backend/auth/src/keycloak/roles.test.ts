import { describe, expect, it } from 'vitest';

import {
  extractKeycloakRoleNames,
  keycloakRoleCatalog,
  mapKeycloakRoles,
} from './roles.js';

describe('mapKeycloakRoles', () => {
  it('maps known Keycloak realm roles onto platform assignments', () => {
    const roles = mapKeycloakRoles(['admin', 'TEACHER', 'unknown', 'admin'], {
      areaId: 'area-1',
    });

    expect(roles).toEqual([
      { roleId: 'admin', roleName: 'Administrator', areaId: 'area-1' },
      { roleId: 'teacher', roleName: 'Teacher', areaId: 'area-1' },
    ]);
  });

  it('returns an empty list when Keycloak sent no school roles', () => {
    expect(mapKeycloakRoles(['offline_access', 'uma_authorization'])).toEqual([]);
  });
});

describe('extractKeycloakRoleNames', () => {
  it('reads realm, resource, and top-level role claims', () => {
    const names = extractKeycloakRoleNames({
      roles: ['staff'],
      realm_access: { roles: ['teacher'] },
      resource_access: { 'proctira-gateway': { roles: ['admin'] } },
    });

    expect(names.sort()).toEqual(['admin', 'staff', 'teacher']);
  });
});

describe('keycloakRoleCatalog', () => {
  it('exposes the six school roles Keycloak manages', () => {
    expect(keycloakRoleCatalog().map((role) => role.roleId)).toEqual([
      'super-admin',
      'admin',
      'principal',
      'teacher',
      'staff',
      'guardian',
    ]);
  });
});
