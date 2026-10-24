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

import { DEFAULT_ROLES } from '@proctira/auth';
import { KEYCLOAK_REALM_ROLES } from '@proctira/backend-auth';
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

  it('every role id the gateway registry gates on exists in the realm catalogue', () => {
    const registry = createGatewayRbacRegistry();
    const gatewayRoleIds = registry.getAllRoles().map((role) => role.roleId);
    const catalogueSet = new Set<string>(catalogue);
    for (const roleId of gatewayRoleIds) {
      expect(catalogueSet.has(roleId)).toBe(true);
    }
  });

  it('platform_admin and super-admin are the only holders of *:manage', () => {
    const wildcardManagers = DEFAULT_ROLES.filter((role) =>
      role.permissions.some((p) => p.resource === '*' && p.action === 'manage'),
    ).map((role) => role.roleId);
    expect(sorted(wildcardManagers)).toEqual(['platform_admin', 'super-admin']);
  });
});
