/**
 * PRC-M254 — the hand-written Dart api-client (packages/flutter-core/api-client)
 * pins every route it calls in `contract/client_routes.json` (enforced on the
 * Dart side by `test/api_contract_test.dart`). This test fails closed when any
 * of those routes is not registered on the gateway, so a renamed/removed
 * backend route breaks CI instead of the mobile app in the field.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT = join(
  HERE,
  '../../../packages/flutter-core/api-client/contract/client_routes.json',
);

function config(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 5000 },
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

function loadRoutes(): Array<{ method: HTTPMethods; url: string }> {
  const parsed = JSON.parse(readFileSync(CONTRACT, 'utf8')) as { routes: string[] };
  return parsed.routes.map((line) => {
    const [method, url] = line.split(' ');
    return { method: method as HTTPMethods, url: url! };
  });
}

const PROBE_HEADER = 'x-dart-contract-probe';
const SAMPLE_ID = '00000000-0000-4000-8000-000000000001';
const TENANT = '550e8400-e29b-41d4-a716-446655440000';
/**
 * Prefixes the gateway deliberately forwards to a separately deployed service
 * (`config.services`), where a `/*` proxy match is the expected registration.
 * Everything else must match a concrete in-process route template.
 */
const PROXIED_PREFIXES = ['/api/v1/auth/'] as const;

/**
 * Pre-existing drift found when this contract test was introduced (PRC-M254):
 * the Dart client calls these routes but the gateway registers no matching
 * route template. Re-pointing the client needs an owner decision on the
 * target endpoints (attendance/report/institution/notification read APIs).
 * The test fails if this list grows (new drift) or if an entry starts
 * resolving (remove it from the list).
 */
const KNOWN_DRIFT: readonly string[] = [
  'DELETE /api/v1/attendance/students/:id',
  'GET /api/v1/attendance/students/:id',
  'GET /api/v1/institutions/:id/academic-periods',
  'GET /api/v1/institutions/:id/contact',
  'GET /api/v1/institutions/:id/infrastructure',
  'GET /api/v1/notifications',
  'GET /api/v1/reports',
  'GET /api/v1/reports/:id',
  'GET /api/v1/reports/:id/download',
  'POST /api/v1/attendance/students',
  'POST /api/v1/reports',
  'PUT /api/v1/attendance/students/:id',
];

describe('Dart api-client route contract (PRC-M254)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    // Classify by the matched route template (request.routeOptions.url): it is
    // undefined for Fastify's not-found handler, so unknown paths fail closed.
    // Probes short-circuit here, before auth/handlers, so no side effects run.
    app.addHook('onRequest', async (request, reply) => {
      if (request.headers[PROBE_HEADER] !== '1') return;
      await reply
        .code(299)
        .header('x-matched-route', request.routeOptions.url ?? '')
        .send('');
    });
    await app.ready();
  }, 120_000);

  async function matchedRoute(method: HTTPMethods, url: string): Promise<string | null> {
    const res = await app.inject({
      method,
      url: url.replaceAll(':id', SAMPLE_ID),
      headers: {
        [PROBE_HEADER]: '1',
        'x-tenant-id': TENANT,
        // The gateway authenticates before our probe hook, so present a valid
        // token; the probe still replies before any handler runs.
        authorization: `Bearer ${app.jwt.sign({
          sub: 'dart-contract-probe',
          tenantId: TENANT,
          email: 'probe@example.com',
          displayName: 'Probe',
          roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
          areas: [],
          institutions: [],
          jti: 'jti-dart-contract',
          sessionId: 'session-dart-contract',
        } as never)}`,
      },
    });
    if (res.statusCode !== 299) return null;
    const matched = res.headers['x-matched-route'];
    return typeof matched === 'string' && matched.length > 0 ? matched : null;
  }

  afterAll(async () => {
    await app.close();
  });

  it('contract file is non-empty and well-formed', () => {
    const routes = loadRoutes();
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      expect(r.url.startsWith('/api/v1/')).toBe(true);
    }
  });

  it('every route the Dart client calls is registered on the gateway', async () => {
    const missing: string[] = [];
    for (const r of loadRoutes()) {
      const matched = await matchedRoute(r.method, r.url);
      // A wildcard proxy (`/*`) match does not prove the route exists.
      const proxied = PROXIED_PREFIXES.some((p) => r.url.startsWith(p));
      if (matched === null || (matched.endsWith('*') && !proxied)) {
        missing.push(`${r.method} ${r.url}`);
      }
    }
    // Exact equality: new drift fails, and so does a stale KNOWN_DRIFT entry.
    expect(missing.sort()).toEqual([...KNOWN_DRIFT].sort());
  });

  it('fails closed for a route that does not exist', async () => {
    expect(await matchedRoute('GET', '/api/v1/definitely-not-a-route/:id')).toBeNull();
  });
});
