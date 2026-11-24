/**
 * PRC-M015: realm <-> catalogue <-> DEFAULT_ROLES <-> gateway-registry parity.
 *
 * The role vocabulary lives in four places that must never drift:
 *   1. `infra/keycloak/proctira-realm.json` roles.realm[].name  (what Keycloak can issue)
 *   2. `KEYCLOAK_REALM_ROLES`                                   (what mapKeycloakRoles keeps)
 *   3. `DEFAULT_ROLES.map(roleId)`                              (the permission definitions)
 *   4. role ids used by `createGatewayRbacRegistry()`          (what the gateway gates on)
 *
 * Before D2, (4) named roles (registrar, examinations_officer, platform_admin, ...) that
 * were absent from (1)-(3), so mapKeycloakRoles silently dropped them for real Keycloak
 * tokens. This test is the drift guard that keeps the four sets reconciled.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_ROLES, canonicalRoleId } from '@proctira/auth';
import { KEYCLOAK_REALM_ROLES, mapKeycloakRoles } from '@proctira/backend-auth';
import { describe, expect, it } from 'vitest';

import { createGatewayRbacRegistry } from './rbac-registry.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '../../..');

interface RealmExport {
  roles: { realm: Array<{ name: string; description?: string }> };
}

function loadRealmRoleNames(): string[] {
  const raw = readFileSync(join(REPO_ROOT, 'infra/keycloak/proctira-realm.json'), 'utf8');
  const parsed = JSON.parse(raw) as RealmExport;
  return parsed.roles.realm.map((role) => role.name);
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

describe('PRC-M015 role-catalogue parity', () => {
  const realmRoleNames = loadRealmRoleNames();
  const catalogue = [...KEYCLOAK_REALM_ROLES];
  const defaultRoleIds = DEFAULT_ROLES.map((role) => role.roleId);

  it('realm JSON, KEYCLOAK_REALM_ROLES, and DEFAULT_ROLES are mutually-equal sets', () => {
    expect(sorted(realmRoleNames)).toEqual(sorted(catalogue));
    expect(sorted(defaultRoleIds)).toEqual(sorted(catalogue));
  });

  it('contains no duplicate role ids in any artifact', () => {
    expect(realmRoleNames.length).toBe(new Set(realmRoleNames).size);
    expect(catalogue.length).toBe(new Set(catalogue).size);
    expect(defaultRoleIds.length).toBe(new Set(defaultRoleIds).size);
  });

  it('keeps the six original realm roles first and unchanged in the catalogue', () => {
    expect(catalogue.slice(0, 6)).toEqual([
      'super-admin',
      'admin',
      'principal',
      'teacher',
      'staff',
      'guardian',
    ]);
  });

  it('every role id the gateway registry gates on is a realm role, in some spelling', () => {
    // The registry lists both spellings for hostel/transport staff
    // (`hostel_warden`, `hostel-warden`); the realm defines one and
    // canonicalRoleId maps the other onto it.
    const registry = createGatewayRbacRegistry();
    const catalogueSet = new Set<string>(catalogue);
    const unknown = registry
      .getAllRoles()
      .map((role) => role.roleId)
      .filter((roleId) => canonicalRoleId(roleId, catalogueSet) === undefined);
    expect(unknown).toEqual([]);
  });

  it('a Keycloak token for each gateway role id keeps that role after mapping', () => {
    const roleCatalog = createGatewayRbacRegistry().getAllRoles();
    for (const { roleId } of roleCatalog) {
      expect(mapKeycloakRoles([roleId], { roleCatalog }).map((role) => role.roleId)).toEqual([
        roleId,
      ]);
    }
  });

  it('PRC-L276: attendance_officer is a realm role the gateway grants attendance only', () => {
    expect(realmRoleNames).toContain('attendance_officer');
    const registry = createGatewayRbacRegistry();
    const roleCatalog = registry.getAllRoles();
    expect(
      mapKeycloakRoles(['attendance-officer'], { roleCatalog }).map((role) => role.roleId),
    ).toEqual(['attendance_officer']);
    for (const action of ['read', 'list', 'create', 'update'] as const) {
      expect(registry.roleHasPermission('attendance_officer', 'attendance', action), action).toBe(
        true,
      );
    }
    const resources = new Set(
      registry.getRole('attendance_officer')?.permissions.map((p) => p.resource),
    );
    expect([...resources]).toEqual(['attendance']);
  });

  it('platform_admin and super-admin are the only holders of *:manage', () => {
    const wildcardManagers = DEFAULT_ROLES.filter((role) =>
      role.permissions.some((p) => p.resource === '*' && p.action === 'manage'),
    ).map((role) => role.roleId);
    expect(sorted(wildcardManagers)).toEqual(['platform_admin', 'super-admin']);
  });
});
