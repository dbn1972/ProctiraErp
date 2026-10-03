/**
 * PRC-M002 / PRC-M004: the platform-admin console contract is enforced by the gateway.
 *  - every path the console client calls is a registered route (no silent 404s)
 *  - tenant lifecycle reason and transitions are validated server-side
 *  - plugin "reject" is its own status
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TENANT_LIFECYCLE_TRANSITIONS, platformAdminUiPlugin } from './platform-admin-ui-plugin.js';

const PLATFORM_ROLES = [{ roleId: 'platform_admin', roleName: 'Platform admin', areaId: null }];
const OPERATOR = { sub: 'op-1', email: 'op1@proctira.org' };
const REASON = 'Contract breach confirmed by finance team';

const CONSOLE_API_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../admin-console/src/lib/api',
);

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Extract `gatewayFetch` paths from the console client sources. `${pathSegment(x)}` becomes a
 * concrete id; `${verbSegment(v, LIST)}` expands to every literal in the exported LIST const.
 */
function consoleRoutes(): Array<{ method: Method; url: string }> {
  const out: Array<{ method: Method; url: string }> = [];
  for (const file of readdirSync(CONSOLE_API_DIR)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts') || file === 'gateway.ts') continue;
    const src = readFileSync(join(CONSOLE_API_DIR, file), 'utf8');
    const lists = new Map<string, string[]>();
    for (const m of src.matchAll(/export const (\w+) = \[([^\]]+)\] as const/g)) {
      lists.set(
        m[1]!,
        [...m[2]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!),
      );
    }
    // Tenant lifecycle builds its path in a local before calling gatewayFetch.
    if (file === 'tenants.ts') {
      for (const verb of lists.get('TENANT_LIFECYCLE_ACTIONS') ?? []) {
        out.push(
          verb === 'offboard'
            ? { method: 'DELETE', url: '/tenants/tnt_x' }
            : { method: 'POST', url: `/tenants/tnt_x/${verb}` },
        );
      }
    }
    for (const m of src.matchAll(
      /gatewayFetch<[\s\S]*?>\(\s*([`'])([^`']+)\1(?:,\s*\{([^}]*))?/g,
    )) {
      const raw = m[2]!;
      const method = (/method:\s*'(\w+)'/.exec(m[3] ?? '')?.[1] ??
        (m[3]?.includes('json:') ? 'POST' : 'GET')) as Method;
      const withIds = raw.replace(/\$\{pathSegment\([^)]*\)\}/g, 'id_x');
      const verb = /\$\{verbSegment\(\w+, (\w+)\)\}/.exec(withIds);
      const urls = verb
        ? (lists.get(verb[1]!) ?? []).map((v) => withIds.replace(verb[0], v))
        : [withIds];
      for (const url of urls) out.push({ method, url: url.split('?')[0]! });
    }
  }
  return out;
}

describe('platform-admin console contract (gateway)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.stubEnv('SEED_DEMO_DATA', '1');
    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { user: unknown }).user = { ...OPERATOR, roles: PLATFORM_ROLES };
    });
    await app.register(platformAdminUiPlugin);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('registers every path the console client calls (PRC-M002)', () => {
    const routes = consoleRoutes();
    // Sanity: the extractor found the write paths that used to be missing.
    expect(routes).toEqual(
      expect.arrayContaining([
        { method: 'PUT', url: '/plans/id_x/entitlements' },
        { method: 'POST', url: '/themes/id_x/approve' },
        { method: 'POST', url: '/break-glass/id_x/revoke' },
      ]),
    );
    const missing = routes.filter(({ method, url }) => !app.hasRoute({ method, url }));
    // hasRoute matches by pattern, so test with the parametric form too.
    const unresolved = missing.filter(
      ({ method, url }) => !app.hasRoute({ method, url: url.replace(/id_x|tnt_x/g, ':id') }),
    );
    expect(unresolved).toEqual([]);
  });

  it('answers 501 (not 404) for console writes without a backing service', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/plans/plan_standard/entitlements',
      payload: { entitlements: [] },
    });
    expect(put.statusCode).toBe(501);
    const theme = await app.inject({
      method: 'POST',
      url: '/themes/theme_default/approve',
      payload: { reason: REASON },
    });
    expect(theme.statusCode).toBe(501);
    expect((await app.inject({ method: 'GET', url: '/plans/plan_unknown' })).statusCode).toBe(404);
  });

  async function newTenant(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/tenants',
      payload: {
        name: 'Contract School',
        slug: `contract-${Math.random().toString(36).slice(2, 8)}`,
        contactEmail: 'it@school.test',
        plan: 'standard',
        region: 'ap-south-1',
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  const lifecycle = (id: string, action: string, reason?: string) =>
    app.inject({
      method: action === 'offboard' ? 'DELETE' : 'POST',
      url: action === 'offboard' ? `/tenants/${id}` : `/tenants/${id}/${action}`,
      payload: reason === undefined ? {} : { reason },
    });

  it('requires a reason of at least 10 characters for every lifecycle action (PRC-M004)', async () => {
    const id = await newTenant();
    for (const action of ['suspend', 'reactivate', 'decommission', 'offboard']) {
      expect((await lifecycle(id, action)).statusCode).toBe(400);
      expect((await lifecycle(id, action, 'too short')).statusCode).toBe(400);
    }
  });

  it('enforces the transition table: archived/decommissioning tenants cannot be reactivated', async () => {
    const id = await newTenant();
    // provisioning -> reactivate is not a legal transition
    expect((await lifecycle(id, 'reactivate', REASON)).statusCode).toBe(409);
    expect((await lifecycle(id, 'decommission', REASON)).statusCode).toBe(200);
    const reactivate = await lifecycle(id, 'reactivate', REASON);
    expect(reactivate.statusCode).toBe(409);
    expect(reactivate.json()).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect((await lifecycle(id, 'offboard', REASON)).json()).toMatchObject({ status: 'archived' });
    expect((await lifecycle(id, 'reactivate', REASON)).statusCode).toBe(409);
    expect((await lifecycle(id, 'suspend', REASON)).statusCode).toBe(409);
  });

  it('keeps the table aligned with the console buttons', () => {
    expect(TENANT_LIFECYCLE_TRANSITIONS.reactivate.from).toEqual(['suspended']);
    expect(TENANT_LIFECYCLE_TRANSITIONS.suspend.from).toEqual(['active']);
  });

  it('checks the real tenant service status before a transition', async () => {
    const svc = Fastify();
    svc.decorateRequest('user', null);
    svc.addHook('onRequest', async (request) => {
      (request as unknown as { user: unknown }).user = { ...OPERATOR, roles: PLATFORM_ROLES };
    });
    let reactivated = false;
    svc.decorate('tenantService', {
      getTenantById: async (id: string) => ({
        id,
        slug: 's',
        name: 'S',
        status: 'decommissioned',
        createdAt: new Date(),
      }),
      reactivateTenant: async () => {
        reactivated = true;
        throw new Error('must not be called');
      },
    });
    await svc.register(platformAdminUiPlugin);
    await svc.ready();
    const res = await svc.inject({
      method: 'POST',
      url: '/tenants/tnt_real/reactivate',
      payload: { reason: REASON },
    });
    expect(res.statusCode).toBe(409);
    expect(reactivated).toBe(false);
    await svc.close();
  });

  it('maps plugin reject to a rejected status, not revoked (PRC-M002)', async () => {
    const list = (await app.inject({ method: 'GET', url: '/plugins' })).json() as {
      items: Array<{ id: string; status: string }>;
    };
    const target = list.items.find((p) => p.status === 'in_review');
    expect(target).toBeDefined();
    const res = await app.inject({
      method: 'POST',
      url: `/plugins/${target!.id}/reject`,
      payload: { reason: 'Manifest requests excessive scopes' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'rejected' });
  });
});
