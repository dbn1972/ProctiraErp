import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_ROLES } from '@proctira/auth';
import { describe, expect, it } from 'vitest';

import { repoRootFromHere } from '../repo.js';
import { TENANTS } from '../seed/tenants.js';

import { listCatalogueRoles, PORTAL_ROLES, realmRoleNames, UAT_ROLE_USERS } from './roles.js';

const root = repoRootFromHere();

describe('role catalogue', () => {
  it('contains every DEFAULT_ROLES id and every realm role', () => {
    const ids = new Set(listCatalogueRoles(root).map((r) => r.roleId));
    for (const r of DEFAULT_ROLES) expect(ids).toContain(r.roleId);
    expect(realmRoleNames(root).length).toBeGreaterThan(10);
    const roles = listCatalogueRoles(root);
    expect(roles.filter((r) => r.sources.realm).length).toBeGreaterThan(0);
    expect(roles.filter((r) => r.sources.uatUser).map((r) => r.roleId)).toContain('warden');
  });

  it('UAT_ROLE_USERS matches ROLE_USERS in tools/scripts/uatenv/uatenv-keycloak.sh (drift guard)', () => {
    const sh = readFileSync(join(root, 'tools/scripts/uatenv/uatenv-keycloak.sh'), 'utf8');
    const block = /ROLE_USERS=\(\n([\s\S]*?)\n\)/.exec(sh)?.[1] ?? '';
    const rows = [...block.matchAll(/"([^"]+)"/g)].map((m) => (m[1] ?? '').split('|'));
    expect(rows).toHaveLength(17);
    const tenantFor = (id: string) =>
      id === '$SUNRISE_ID'
        ? TENANTS.S.id
        : id === '$TENANT_B_ID'
          ? TENANTS.A.id
          : id === '$PLATFORM_TENANT'
            ? 'platform'
            : id;
    expect(
      UAT_ROLE_USERS.map((u) => [
        u.usernamePrefix,
        u.role,
        u.tenant === 'platform' ? 'platform' : TENANTS[u.tenant].id,
        u.displayName,
      ]),
    ).toEqual(
      rows.map(([prefix, role, , tid, name]) => [prefix, role, tenantFor(tid ?? ''), name]),
    );
  });

  it('portal roles match domain-route-guards PORTAL_ONLY_ROLE_IDS', () => {
    const guards = readFileSync(join(root, 'apps/web/src/lib/auth/domain-route-guards.ts'), 'utf8');
    const ids = /PORTAL_ONLY_ROLE_IDS[^=]*=\s*new Set\(\[([^\]]*)\]/.exec(guards)?.[1] ?? '';
    expect([...PORTAL_ROLES].sort()).toEqual(
      [...ids.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort(),
    );
  });
});
