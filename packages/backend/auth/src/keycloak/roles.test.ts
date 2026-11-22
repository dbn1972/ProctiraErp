import { describe, expect, it } from 'vitest';

import { extractKeycloakRoleNames, keycloakRoleCatalog, mapKeycloakRoles } from './roles.js';

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

  it('keeps every role in the supplied catalogue and drops the rest (UATENV-D07)', () => {
    const roleCatalog = [
      { roleId: 'admin', roleName: 'Administrator' },
      { roleId: 'warden', roleName: 'Warden' },
      { roleId: 'transport_officer', roleName: 'Transport Officer' },
      { roleId: 'student', roleName: 'Student' },
    ];
    const roles = mapKeycloakRoles(
      ['Warden', 'transport_officer', 'student', 'admin', 'offline_access', 'default-roles-x'],
      { roleCatalog },
    );
    expect(roles).toEqual([
      { roleId: 'warden', roleName: 'Warden', areaId: 'ROOT' },
      { roleId: 'transport_officer', roleName: 'Transport Officer', areaId: 'ROOT' },
      { roleId: 'student', roleName: 'Student', areaId: 'ROOT' },
      { roleId: 'admin', roleName: 'Administrator', areaId: 'ROOT' },
    ]);
  });

  it('grants nothing outside the supplied catalogue, even a built-in role (UATENV-D07)', () => {
    expect(
      mapKeycloakRoles(['super-admin', 'teacher'], {
        roleCatalog: [{ roleId: 'teacher', roleName: 'Teacher' }],
      }).map((role) => role.roleId),
    ).toEqual(['teacher']);
  });
});

describe('extractKeycloakRoleNames', () => {
  it('reads realm roles and only the configured client roles (PRC-M178)', () => {
    const names = extractKeycloakRoleNames(
      {
        roles: ['staff'],
        realm_access: { roles: ['teacher'] },
        resource_access: {
          'proctira-gateway': { roles: ['admin'] },
          'other-client': { roles: ['super-admin'] },
        },
      },
      'proctira-gateway',
    );
    expect(names.sort()).toEqual(['admin', 'teacher']);
  });

  it('ignores roles granted on other clients and the top-level roles claim (PRC-M178)', () => {
    const payload = {
      roles: ['super-admin'],
      resource_access: { 'other-client': { roles: ['super-admin', 'admin'] } },
    };
    expect(extractKeycloakRoleNames(payload, 'proctira-gateway')).toEqual([]);
    expect(mapKeycloakRoles(extractKeycloakRoleNames(payload, 'proctira-gateway'))).toEqual([]);
    expect(extractKeycloakRoleNames(payload)).toEqual([]);
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
