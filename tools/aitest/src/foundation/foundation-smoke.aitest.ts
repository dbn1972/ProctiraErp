/**
 * foundation-smoke: proves a throwaway aitest stack is usable by the tracks.
 *
 * Stack up + seed + manifest (S and A have students and institutions), one
 * token per UAT role user accepted by the gateway, S admin reads S data, A
 * admin is refused S records, broken tokens are refused, API inventory
 * >= 300 routes, web routes >= 250, a tenant snapshot is stable.
 * With a Keycloak stack (foundation-keycloak-smoke) every role user also
 * gets a real password-grant token that the gateway accepts.
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  diffSnapshots,
  fetchApiInventory,
  keycloakPasswordGrant,
  keycloakUsernames,
  listTenantTablesWithId,
  listWebRoutes,
  loadStackContext,
  PLATFORM_TENANT,
  ResultsRecorder,
  snapshotTenant,
  TENANTS,
  UAT_ROLE_USERS,
  withPg,
} from './index.js';

const ctx = loadStackContext();
const recorder = new ResultsRecorder(ctx.outDir, 'foundation', { trackDir: __dirname });
const api = ctx.api();
const kcMode = ctx.state.keycloak === true;
/** Self-service read every authenticated principal may make (rbac-registry SELF_SERVICE_READ_RESOURCES). */
const SELF_READ = '/api/v1/notifications/preferences';
const PLATFORM_SKIP =
  "platform-tenant users carry tenantId 'platform'; the gateway requires a UUID tenant claim for tenant-scoped reads (tenant-resolution.ts W1-SEC-01), so this user is exercised through the admin console by t01/t12";

afterAll(() => {
  recorder.write();
});

describe('foundation-smoke', () => {
  it('seeded S and A with students and institutions; manifest built', async () => {
    const f = ctx.fixtures;
    for (const k of ['S', 'A'] as const) {
      const students = f.ids['students']?.[k]?.length ?? 0;
      const institutions = f.tenants[k].institutions.length;
      recorder.record(`seed:${k}`, students > 0 && institutions > 0, {
        detail: `${TENANTS[k].slug}: ${students} sampled students, ${institutions} institutions`,
      });
    }
    recorder.record('seed:SUSP-suspended', f.tenants.SUSP.status === 'suspended', {
      detail: f.tenants.SUSP.status,
    });
    recorder.record('seed:EMPTY-active', f.tenants.EMPTY.status === 'active', {
      detail: f.tenants.EMPTY.status,
    });
    const withData = Object.keys(f.ids).length;
    const allTables = await withPg(ctx.db.bootstrapUrl(), (c) => listTenantTablesWithId(c));
    recorder.coverage('tenant tables (with id) holding seeded rows', withData, allTables.length);
    recorder.record(
      'seed:portal-principals',
      (f.principals.guardians.S?.length ?? 0) > 0 && (f.principals.students.S?.length ?? 0) > 0,
      {
        detail: `S guardians ${f.principals.guardians.S?.length ?? 0}, S student self-bindings ${f.principals.students.S?.length ?? 0}`,
      },
    );
  });

  it('HS256 token for every UAT role user is accepted', async () => {
    for (const u of UAT_ROLE_USERS) {
      const id = `hs256-role-user:${u.usernamePrefix}`;
      if (kcMode) {
        recorder.record(id, 'skip', {
          reason: 'Keycloak stack: the gateway verifies RS256 only (see keycloak cases)',
        });
        continue;
      }
      if (u.tenant === PLATFORM_TENANT) {
        recorder.record(id, 'skip', { reason: PLATFORM_SKIP });
        continue;
      }
      const r = await api.as(ctx.tokens.principal(u.role, u.tenant)).get(SELF_READ);
      recorder.record(id, r.status === 200, {
        detail: `${u.role}@${u.tenant} GET ${SELF_READ} -> ${r.status}`,
      });
    }
  });

  it('S admin reads S students; A admin is refused an S student', async () => {
    if (kcMode) {
      recorder.record('tenancy:S-admin-list', 'skip', {
        reason: 'Keycloak stack: HS256 principals are refused',
      });
      recorder.record('tenancy:A-admin-S-student', 'skip', {
        reason: 'Keycloak stack: HS256 principals are refused',
      });
      return;
    }
    const sid = ctx.fixtures.ids['students']?.S?.[0] ?? '';
    const list = await api.as(ctx.tokens.principal('admin', 'S')).get('/api/v1/students');
    recorder.record('tenancy:S-admin-list', list.status === 200, {
      detail: `GET /api/v1/students -> ${list.status}`,
    });
    const own = await api.as(ctx.tokens.principal('admin', 'S')).get(`/api/v1/students/${sid}`);
    const name = (own.json as { firstName?: string } | undefined)?.firstName ?? '';
    const cross = await api.as(ctx.tokens.principal('admin', 'A')).get(`/api/v1/students/${sid}`);
    const leaked = name !== '' && cross.text.includes(name);
    recorder.record('tenancy:A-admin-S-student', [403, 404].includes(cross.status) && !leaked, {
      detail: `A admin GET S student -> ${cross.status}, S field in body: ${String(leaked)}`,
    });
  });

  it('broken tokens are refused', async () => {
    const p = ctx.tokens.principal('admin', 'S');
    const cases: Array<[string, string | null]> = [
      ['anonymous', null],
      ['garbled-signature', ctx.tokens.mint(p, { signature: 'garble' })],
      ['alg-none', ctx.tokens.mint(p, { alg: 'none' })],
      [
        'expired',
        ctx.tokens.mint(p, { issuedAtSec: Math.floor(Date.now() / 1000) - 7200, expiresInSec: 60 }),
      ],
      ['wrong-secret', ctx.tokens.mint(p, { secret: 'not-the-stack-secret-0123456789abcdef' })],
    ];
    for (const [name, token] of cases) {
      const r = await api
        .as(token ? { token, tenantId: TENANTS.S.id } : null)
        .get('/api/v1/students');
      recorder.record(`auth:${name}`, r.status === 401, { detail: `-> ${r.status}` });
    }
  });

  it('API inventory and web routes', async () => {
    const routes = await fetchApiInventory(ctx.state.urls.gateways[0] ?? '');
    recorder.record('inventory:api>=300', routes.length >= 300, {
      detail: `${routes.length} routes`,
    });
    recorder.coverage(
      'API routes mapped to an RBAC resource',
      routes.filter((r) => r.resource).length,
      routes.length,
    );
    const mod = (await import(
      pathToFileURL(join(ctx.state.repoRoot, 'apps/api-gateway/src/mutating-route-authz.ts')).href
    )) as { MUTATING_ROUTE_AUTHZ_INVENTORY: ReadonlyArray<{ id: string; pathPrefix: string }> };
    const misses = mod.MUTATING_ROUTE_AUTHZ_INVENTORY.filter(
      (rule) => !routes.some((r) => r.path.startsWith(rule.pathPrefix)),
    );
    recorder.coverage(
      'MUTATING_ROUTE_AUTHZ_INVENTORY prefixes matching an inventory route',
      mod.MUTATING_ROUTE_AUTHZ_INVENTORY.length - misses.length,
      mod.MUTATING_ROUTE_AUTHZ_INVENTORY.length,
    );
    recorder.record('inventory:mutating-prefixes', true, {
      detail: misses.length
        ? `prefixes with no route: ${misses.map((m) => m.pathPrefix).join(' ')}`
        : 'all matched',
    });
    const web = listWebRoutes(undefined, ctx.state.repoRoot);
    recorder.record('inventory:web>=250', web.length >= 250, {
      detail: `${web.length} page routes`,
    });
  });

  it('tenant snapshot is stable across two reads', async () => {
    const a = await snapshotTenant(ctx.state, TENANTS.S.id);
    const b = await snapshotTenant(ctx.state, TENANTS.S.id);
    const diff = diffSnapshots(a, b);
    recorder.record('snapshot:S-stable', diff.length === 0, {
      detail: `${Object.keys(a.tables).length} tables, diff ${diff.map((d) => d.table).join(' ') || 'none'}`,
    });
  });

  it('Keycloak: password-grant token for every role user, accepted by the gateway', async () => {
    const names = keycloakUsernames();
    for (const [i, username] of names.entries()) {
      const u = UAT_ROLE_USERS[i];
      const id = `keycloak-role-user:${u?.usernamePrefix ?? username}`;
      if (!kcMode) {
        recorder.record(id, 'skip', {
          reason: 'stack started without --keycloak (foundation-keycloak-smoke covers it)',
        });
        continue;
      }
      let token: string;
      try {
        token = (await keycloakPasswordGrant(ctx.state, username)).accessToken;
      } catch (err) {
        recorder.record(id, false, { detail: `password grant failed: ${String(err)}` });
        continue;
      }
      if (u?.tenant === PLATFORM_TENANT) {
        recorder.record(`${id}:grant`, token.split('.').length === 3, { detail: 'token issued' });
        recorder.record(id, 'skip', { reason: PLATFORM_SKIP });
        continue;
      }
      const tenantId = u ? TENANTS[u.tenant].id : '';
      const r = await api.as({ token, tenantId }).get(SELF_READ);
      recorder.record(id, r.status === 200, {
        detail: `${u?.role ?? '?'} GET ${SELF_READ} -> ${r.status}`,
      });
    }
  });

  it('no case failed', () => {
    expect(recorder.failures()).toEqual([]);
  });
});
