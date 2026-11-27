/**
 * Role catalogue for aitest: DEFAULT_ROLES (@proctira/auth) ∪ Keycloak realm
 * roles (infra/keycloak/proctira-realm.json) ∪ the UAT role users, with role
 * spellings normalised by canonicalRoleId.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { canonicalRoleId, DEFAULT_ROLES } from '@proctira/auth';

import { repoRootFromHere } from '../repo.js';
import type { TenantKey } from '../seed/tenants.js';

export interface CatalogueRole {
  roleId: string;
  roleName: string;
  sources: { defaultRoles: boolean; realm: boolean; uatUser: boolean };
}

export interface UatRoleUser {
  usernamePrefix: string;
  role: string;
  tenant: TenantKey | 'platform';
  displayName: string;
}

/**
 * Port of ROLE_USERS in tools/scripts/uatenv/uatenv-keycloak.sh (17 rows).
 * roles.test.ts parses the script and fails when the two drift.
 */
export const UAT_ROLE_USERS: ReadonlyArray<UatRoleUser> = Object.freeze([
  {
    usernamePrefix: 'uat-platform-admin',
    role: 'super-admin',
    tenant: 'S',
    displayName: 'Platform Admin',
  },
  { usernamePrefix: 'uat-tenant-admin', role: 'admin', tenant: 'S', displayName: 'Tenant Admin' },
  { usernamePrefix: 'uat-principal', role: 'principal', tenant: 'S', displayName: 'Principal' },
  { usernamePrefix: 'uat-teacher', role: 'teacher', tenant: 'S', displayName: 'Teacher' },
  { usernamePrefix: 'uat-staff', role: 'staff', tenant: 'S', displayName: 'Office Staff' },
  { usernamePrefix: 'uat-bursar', role: 'bursar', tenant: 'S', displayName: 'Bursar' },
  { usernamePrefix: 'uat-registrar', role: 'registrar', tenant: 'S', displayName: 'Registrar' },
  { usernamePrefix: 'uat-warden', role: 'warden', tenant: 'S', displayName: 'Hostel Warden' },
  {
    usernamePrefix: 'uat-transport-officer',
    role: 'transport_officer',
    tenant: 'S',
    displayName: 'Transport Officer',
  },
  { usernamePrefix: 'uat-nurse', role: 'nurse', tenant: 'S', displayName: 'School Nurse' },
  { usernamePrefix: 'uat-librarian', role: 'librarian', tenant: 'S', displayName: 'Librarian' },
  { usernamePrefix: 'uat-parent', role: 'guardian', tenant: 'S', displayName: 'Parent' },
  { usernamePrefix: 'uat-student', role: 'student', tenant: 'S', displayName: 'Student' },
  {
    usernamePrefix: 'uat-health-admin',
    role: 'health_admin',
    tenant: 'S',
    displayName: 'Health Admin',
  },
  {
    usernamePrefix: 'uat-b-tenant-admin',
    role: 'admin',
    tenant: 'A',
    displayName: 'Tenant B Admin',
  },
  {
    usernamePrefix: 'uat-b-teacher',
    role: 'teacher',
    tenant: 'A',
    displayName: 'Tenant B Teacher',
  },
  {
    usernamePrefix: 'uat-platform-operator',
    role: 'platform_admin',
    tenant: 'platform',
    displayName: 'Platform Operator',
  },
]);

/** apps/web/src/lib/auth/domain-route-guards.ts PORTAL_ONLY_ROLE_IDS. */
export const PORTAL_ROLES: ReadonlySet<string> = new Set(['student', 'guardian', 'parent']);

/** Tenant id and slug of platform-tenant users (uatenv-keycloak.sh PLATFORM_TENANT). */
export const PLATFORM_TENANT = 'platform';

export function realmRoleNames(repoRoot = repoRootFromHere()): string[] {
  const realm = JSON.parse(
    readFileSync(join(repoRoot, 'infra/keycloak/proctira-realm.json'), 'utf8'),
  ) as { roles?: { realm?: Array<{ name: string }> } };
  return (realm.roles?.realm ?? []).map((r) => r.name);
}

export function listCatalogueRoles(repoRoot = repoRootFromHere()): CatalogueRole[] {
  const byId = new Map<string, CatalogueRole>();
  const add = (roleId: string, roleName: string, source: keyof CatalogueRole['sources']) => {
    const entry =
      byId.get(roleId) ??
      ({
        roleId,
        roleName,
        sources: { defaultRoles: false, realm: false, uatUser: false },
      } as CatalogueRole);
    entry.sources[source] = true;
    byId.set(roleId, entry);
  };
  for (const r of DEFAULT_ROLES) add(r.roleId, r.roleName, 'defaultRoles');
  const ids = () => new Set(byId.keys());
  for (const name of realmRoleNames(repoRoot))
    add(canonicalRoleId(name, ids()) ?? name, name, 'realm');
  for (const u of UAT_ROLE_USERS) {
    add(canonicalRoleId(u.role, ids()) ?? u.role, u.displayName, 'uatUser');
  }
  return [...byId.values()].sort((a, b) => a.roleId.localeCompare(b.roleId));
}
