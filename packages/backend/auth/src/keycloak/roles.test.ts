import { describe, expect, it } from 'vitest';

import { DEFAULT_ROLES } from '@proctira/auth';

import {
  KEYCLOAK_REALM_ROLES,
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

  it('maps the newly-added canonical realm roles (PRC-M015: former silent drop closed)', () => {
    const roles = mapKeycloakRoles(['registrar', 'examinations_officer', 'platform_admin'], {
      areaId: 'area-9',
    });

    expect(roles).toEqual([
      { roleId: 'registrar', roleName: 'Registrar', areaId: 'area-9' },
      { roleId: 'examinations_officer', roleName: 'Examinations Officer', areaId: 'area-9' },
      { roleId: 'platform_admin', roleName: 'Platform Administrator', areaId: 'area-9' },
    ]);

    // Each returned roleName must match the DEFAULT_ROLES definition.
    for (const assignment of roles) {
      const definition = DEFAULT_ROLES.find((role) => role.roleId === assignment.roleId);
      expect(definition).toBeDefined();
      expect(assignment.roleName).toBe(definition?.roleName);
    }
  });
  it('maps -/_ spellings and exam-officer synonyms onto catalogue ids (PRC-M015)', () => {
    expect(
      mapKeycloakRoles(['SUPER_ADMIN', 'hostel-warden', 'exam-officer', 'school-nurse']).map(
        (role) => role.roleId,
      ),
    ).toEqual(['super-admin', 'hostel_warden', 'examinations_officer', 'school_nurse']);
  });

  it('keeps an exact catalogue spelling before trying another (PRC-M015)', () => {
    const roleCatalog = [
      { roleId: 'hostel_warden', roleName: 'Hostel Warden' },
      { roleId: 'hostel-warden', roleName: 'Hostel-Warden' },
    ];
    expect(mapKeycloakRoles(['hostel-warden'], { roleCatalog })).toEqual([
      { roleId: 'hostel-warden', roleName: 'Hostel-Warden', areaId: 'ROOT' },
    ]);
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
  it('exposes every canonical realm role Keycloak manages (6 original + D2 additions)', () => {
    // keycloakRoleCatalog() filters DEFAULT_ROLES, so it carries DEFAULT_ROLES
    // order; parity with KEYCLOAK_REALM_ROLES is on the set of ids.
    const catalogueIds = keycloakRoleCatalog().map((role) => role.roleId);
    expect([...catalogueIds].sort()).toEqual([...KEYCLOAK_REALM_ROLES].sort());
  });

  it('keeps the six original realm roles first and in order', () => {
    expect([...KEYCLOAK_REALM_ROLES].slice(0, 6)).toEqual([
      'super-admin',
      'admin',
      'principal',
      'teacher',
      'staff',
      'guardian',
    ]);
  });
});
