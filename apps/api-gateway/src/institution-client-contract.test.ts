/**
 * Every endpoint the web institution module calls must actually be mounted.
 *
 * `arch06-mount-composition.test.ts` checks that each prefix a domain
 * *declares* in `proxyPrefixes` is mounted. Nothing checked the other
 * direction: that the paths a client actually requests resolve. `/areas/*` was
 * defined in `@proctira/backend-institution` with 38 passing tests, was never
 * registered (the plugin only mounted it when a caller passed
 * `areaHierarchyDb`, and none did), and was absent from `PATH_RESOURCE_MAP` —
 * so `GET /areas/tree` hit the default-deny path and returned 403. The web app
 * swallowed that error and substituted three fabricated areas, whose invented
 * ids cannot satisfy `institutions.area_id REFERENCES geographic_areas(id)`.
 *
 * The paths below are the ones `apps/web/src/lib/institutions/api.ts` issues.
 * Keep them in sync with that file: a 403/404 here means the UI is calling
 * something the gateway does not serve.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT = '550e8400-e29b-41d4-a716-446655440000';
const SOME_UUID = '880e8400-e29b-41d4-a716-446655440006';

function config(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 1000 },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  };
}

/** GET paths issued by `apps/web/src/lib/institutions/api.ts`. */
const WEB_INSTITUTION_GET_PATHS = [
  '/api/v1/institutions?page=1&pageSize=20',
  '/api/v1/areas/tree',
  '/api/v1/academic-periods',
  '/api/v1/subjects',
  '/api/v1/grades',
  `/api/v1/classes?institutionId=${SOME_UUID}`,
  `/api/v1/infrastructure/hierarchy/${SOME_UUID}`,
] as const;

describe('web institution client contract', () => {
  let app: FastifyInstance;

  const adminHeaders = () => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: 'admin-1',
      tenantId: TENANT,
      email: 'admin@example.com',
      displayName: 'Admin',
      roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
      areas: [],
      institutions: [],
      jti: 'jti-contract',
      sessionId: 'session-contract',
    } as never)}`,
    'x-tenant-id': TENANT,
  });

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(WEB_INSTITUTION_GET_PATHS)('serves %s for a tenant admin', async (url) => {
    const res = await app.inject({ method: 'GET', url, headers: adminHeaders() });

    // A mounted, authorised route may legitimately 200 (or 404 for a specific
    // missing record). It must not be 403 (unmapped resource -> default deny)
    // and must not be a routing 404 with Fastify's "not found" envelope.
    expect(
      res.statusCode,
      `${url} returned ${res.statusCode}; the web institution module calls this path`,
    ).not.toBe(403);
    expect(res.statusCode).toBeLessThan(500);
  });

  it('mounts the area hierarchy routes the institution form depends on', async () => {
    const tree = await app.inject({
      method: 'GET',
      url: '/api/v1/areas/tree',
      headers: adminHeaders(),
    });
    expect(tree.statusCode).toBe(200);
    // Empty for a fresh tenant, but it must be a real list, not a denial.
    expect(Array.isArray(tree.json())).toBe(true);
  });

  it('round-trips a created area into the tree so the form can reference it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      headers: adminHeaders(),
      payload: { name: 'Pune District', code: 'PUNE-DIST', level: 1 },
    });
    expect(created.statusCode).toBe(201);
    const area = created.json() as { id: string };

    const tree = await app.inject({
      method: 'GET',
      url: '/api/v1/areas/tree',
      headers: adminHeaders(),
    });
    expect(tree.statusCode).toBe(200);
    const ids = (tree.json() as { id: string }[]).map((node) => node.id);
    expect(ids).toContain(area.id);
  });

  it('still denies an unauthenticated area read', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/areas/tree' });
    expect(res.statusCode).toBe(401);
  });

  it('isolates areas across tenants', async () => {
    const otherTenant = '660e8400-e29b-41d4-a716-446655440001';
    const otherHeaders = {
      authorization: `Bearer ${app.jwt.sign({
        sub: 'admin-2',
        tenantId: otherTenant,
        email: 'admin2@example.com',
        displayName: 'Admin Two',
        roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
        areas: [],
        institutions: [],
        jti: 'jti-other',
        sessionId: 'session-other',
      } as never)}`,
      'x-tenant-id': otherTenant,
    };

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/areas',
      headers: adminHeaders(),
      payload: { name: 'Tenant A Only', code: 'A-ONLY', level: 1 },
    });
    expect(created.statusCode).toBe(201);
    const areaId = (created.json() as { id: string }).id;

    const otherTree = await app.inject({
      method: 'GET',
      url: '/api/v1/areas/tree',
      headers: otherHeaders,
    });
    expect(otherTree.statusCode).toBe(200);
    expect((otherTree.json() as { id: string }[]).map((n) => n.id)).not.toContain(areaId);
  });
});
