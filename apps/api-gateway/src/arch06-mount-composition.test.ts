/**
 * W1-ARCH-06 — executable gateway mount composition + persistence.
 *
 * Proves mounted matrix prefixes are registered on a booted gateway (not
 * source-scraped), and that representative persistence kinds round-trip in
 * process without DATABASE_URL (in-memory / fallback path).
 */
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import { DOMAIN_REGISTRAR_COMPOSITION, DOMAIN_REGISTRAR_NAMES } from './domain-plugins.js';
import { EXPECTED_PARKED, MATRIX_REGISTRAR_NAMES, MOUNT_MATRIX } from './mount-matrix.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '550e8400-e29b-41d4-a716-446655440099';

/** Prefixes registered directly in `app.ts` (not DOMAIN_REGISTRARS). */
const APP_TS_DIRECT_PREFIXES = [
  '/auth',
  '/audit-logs',
  '/billing',
  '/tenant-lifecycle',
  '/providers',
] as const;

/**
 * Optional probe overrides when GET on the bare prefix is not a registered
 * route (only nested paths exist). Default probe is GET `/api/v1${prefix}`.
 */
const PREFIX_PROBES: Record<string, { method: string; url: string }> = {
  '/scim': { method: 'GET', url: '/api/v1/scim/v2/ServiceProviderConfig' },
  '/infrastructure': {
    method: 'GET',
    url: '/api/v1/infrastructure/lands',
  },
  '/privacy': { method: 'GET', url: '/api/v1/privacy/legal-holds' },
  '/workflow-engine': {
    method: 'GET',
    url: '/api/v1/workflow-engine/definitions',
  },
  '/pipelines': { method: 'GET', url: '/api/v1/pipelines' },
  '/reports': { method: 'GET', url: '/api/v1/reports/catalogue' },
  '/data-warehouse': {
    method: 'GET',
    url: '/api/v1/data-warehouse/indicators',
  },
  '/break-glass': { method: 'GET', url: '/api/v1/break-glass' },
  '/plans': { method: 'GET', url: '/api/v1/plans' },
  '/platform': { method: 'GET', url: '/api/v1/platform/overview' },
  '/audit': { method: 'GET', url: '/api/v1/audit' },
  '/themes': { method: 'GET', url: '/api/v1/themes' },
  '/plugins': { method: 'GET', url: '/api/v1/plugins' },
  '/tenants': { method: 'GET', url: '/api/v1/tenants' },
  '/providers': { method: 'GET', url: '/api/v1/providers' },
  '/billing': { method: 'GET', url: '/api/v1/billing/plans' },
  '/tenant-lifecycle': {
    method: 'GET',
    url: '/api/v1/tenant-lifecycle/tenants',
  },
  '/auth': { method: 'POST', url: '/api/v1/auth/login' },
  '/student-portal': { method: 'GET', url: '/api/v1/student-portal/me' },
  '/parent-portal': { method: 'GET', url: '/api/v1/parent-portal/children' },
  '/developer': { method: 'GET', url: '/api/v1/developer/keys' },
  '/enrollments': { method: 'GET', url: '/api/v1/enrollments' },
  '/fees': { method: 'GET', url: '/api/v1/fees/invoices' },
  '/admissions': { method: 'GET', url: '/api/v1/admissions/applications' },
  '/registrations': { method: 'GET', url: '/api/v1/registrations' },
  '/assessment-items': { method: 'GET', url: '/api/v1/assessment-items' },
  '/grading-schemes': { method: 'GET', url: '/api/v1/grading-schemes' },
  '/outcomes': { method: 'GET', url: '/api/v1/outcomes' },
  '/results': { method: 'GET', url: '/api/v1/results' },
  '/report-cards': { method: 'GET', url: '/api/v1/report-cards' },
  '/institution-subjects': {
    method: 'GET',
    url: '/api/v1/institution-subjects',
  },
};

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

/** Fastify's own "route not registered" 404 (vs domain NotFoundError). */
function isUnregisteredRoute(res: LightMyRequestResponse): boolean {
  if (res.statusCode !== 404) return false;
  let body: { message?: string; code?: string } = {};
  try {
    body = res.json() as { message?: string; code?: string };
  } catch {
    return /Route \w+:/.test(res.body);
  }
  if (body.code === 'NOT_FOUND') return false;
  return typeof body.message === 'string' && /^Route \w+:/.test(body.message);
}

function probeFor(prefix: string): { method: string; url: string } {
  return PREFIX_PROBES[prefix] ?? { method: 'GET', url: `/api/v1${prefix}` };
}

describe('W1-ARCH-06 live registrar composition (no source scrape)', () => {
  it('exports DOMAIN_REGISTRAR_NAMES from the executable registrar table', () => {
    expect(DOMAIN_REGISTRAR_NAMES.length).toBeGreaterThan(0);
    expect([...DOMAIN_REGISTRAR_NAMES].sort()).toEqual([...MATRIX_REGISTRAR_NAMES].sort());
    expect(DOMAIN_REGISTRAR_NAMES).not.toContain('custom-field');
    expect(DOMAIN_REGISTRAR_NAMES).not.toContain('dashboards');
  });

  it('DOMAIN_REGISTRAR_COMPOSITION matches names; proxyPrefixes are matrix-mounted', () => {
    expect(DOMAIN_REGISTRAR_COMPOSITION.map((r) => r.name).sort()).toEqual(
      [...DOMAIN_REGISTRAR_NAMES].sort(),
    );

    const liveByName = new Map(DOMAIN_REGISTRAR_COMPOSITION.map((row) => [row.name, row]));

    for (const entry of MOUNT_MATRIX) {
      if (!entry.registrarName || !entry.mounted) continue;
      expect(
        liveByName.has(entry.registrarName),
        `missing live registrar ${entry.registrarName}`,
      ).toBe(true);
    }

    // proxyPrefixes exclude the service-router; plugins may also mount native
    // sibling paths (e.g. assessment → /grading-schemes). Those are proven by
    // the executable inject suite below, not by proxyPrefix equality.
  });

  it('every live proxyPrefix appears on a mounted matrix row (or app.ts direct)', () => {
    const mountedPrefixes = new Set(
      MOUNT_MATRIX.filter((r) => r.mounted).flatMap((r) => r.prefixes),
    );
    for (const direct of APP_TS_DIRECT_PREFIXES) {
      mountedPrefixes.add(direct);
    }
    // insights registers /reports which matrix attributes to backend/report
    const orphans = DOMAIN_REGISTRAR_COMPOSITION.flatMap((r) =>
      r.proxyPrefixes.filter((p) => !mountedPrefixes.has(p)),
    );
    expect(orphans, `Live prefixes missing from mounted matrix: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('W1-ARCH-06 executable mount composition', () => {
  let app: FastifyInstance;

  const adminHeaders = (tenantId = TENANT_A) => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: 'admin-arch06',
      tenantId,
      email: 'admin@example.com',
      displayName: 'Admin',
      roles: [
        { roleId: 'admin', roleName: 'Administrator', areaId: null },
        { roleId: 'platform_admin', roleName: 'Platform Administrator', areaId: null },
      ],
      areas: [],
      institutions: [],
      jti: `jti-${tenantId}`,
      sessionId: `session-${tenantId}`,
    } as never)}`,
    'x-tenant-id': tenantId,
  });

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app.close();
  });

  it('registers every mounted matrix prefix (inject is not Fastify route-missing)', async () => {
    const failures: string[] = [];
    for (const entry of MOUNT_MATRIX.filter((row) => row.mounted)) {
      for (const prefix of entry.prefixes) {
        const probe = probeFor(prefix);
        const res = await app.inject({
          method: probe.method as 'GET',
          url: probe.url,
          headers: {
            ...adminHeaders(),
            'content-type': 'application/json',
          },
          payload: probe.method === 'POST' ? {} : undefined,
        });
        if (isUnregisteredRoute(res)) {
          failures.push(
            `${entry.package}:${prefix} → ${probe.method} ${probe.url} (${res.statusCode}) ${res.body.slice(0, 120)}`,
          );
        }
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('does not register PARKED package prefixes as in-process routes', async () => {
    for (const pkg of EXPECTED_PARKED) {
      const row = MOUNT_MATRIX.find((entry) => entry.package === pkg);
      expect(row).toBeDefined();
      for (const prefix of row!.prefixes) {
        // Prefer a nested path so we do not collide with platform-admin stubs
        // that intentionally own overlapping names (e.g. /themes, /plugins).
        const url =
          prefix === '/themes' || prefix === '/plugins'
            ? `/api/v1${prefix}/__arch06-parked-probe__`
            : `/api/v1${prefix}`;
        const res = await app.inject({
          method: 'GET',
          url,
          headers: adminHeaders(),
        });
        // Parked packages must not contribute their own plugin handlers.
        // Overlapping UI stubs may answer; require either unregistered or a
        // stub/UI response that is not a successful domain list from the parked pkg.
        if (prefix === '/themes' || prefix === '/plugins') {
          expect(
            isUnregisteredRoute(res) || res.statusCode === 404 || res.statusCode === 403,
            `${pkg}${prefix} nested probe should not succeed as parked domain`,
          ).toBe(true);
          continue;
        }
        expect(
          isUnregisteredRoute(res) || res.statusCode === 404,
          `${pkg} ${prefix} should not be composed (${res.statusCode})`,
        ).toBe(true);
      }
    }
  });

  it('persists privacy legal-holds in-process (in-memory composition)', async () => {
    const hold = await app.inject({
      method: 'POST',
      url: '/api/v1/privacy/legal-holds',
      headers: adminHeaders(),
      payload: { scope: 'tenant', reason: 'W1-ARCH-06 persistence' },
    });
    expect(hold.statusCode).toBe(201);
    const id = (hold.json() as { id: string }).id;

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/privacy/legal-holds',
      headers: adminHeaders(),
    });
    expect(listed.statusCode).toBe(200);
    expect((listed.json() as { data: Array<{ id: string }> }).data.some((h) => h.id === id)).toBe(
      true,
    );
  });

  it('persists academic periods in-process (prisma+rls → memory without DATABASE_URL)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/academic-periods',
      headers: adminHeaders(),
      payload: {
        name: 'ARCH06 Term',
        startDate: '2026-01-01',
        endDate: '2026-06-30',
        boardId: 'board-arch06',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/academic-periods',
      headers: adminHeaders(),
    });
    expect(listed.statusCode).toBe(200);
    const rows = listed.json() as Array<{ id: string }>;
    expect(rows.some((r) => r.id === id)).toBe(true);

    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/academic-periods',
      headers: adminHeaders(TENANT_B),
    });
    expect(other.statusCode).toBe(200);
    expect((other.json() as Array<{ id: string }>).some((r) => r.id === id)).toBe(false);
  });

  it('persists fees invoices in-process (raw-pg → memory without DATABASE_URL)', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/fees/invoices',
      headers: adminHeaders(),
      payload: {
        studentId: '11111111-1111-4111-8111-111111111111',
        title: 'ARCH06 fee',
        amountCents: 1500,
        currency: 'INR',
      },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;

    // Fees exposes list + nested actions; no GET /invoices/:id collection read.
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/fees/invoices',
      headers: adminHeaders(),
    });
    expect(listed.statusCode).toBe(200);
    const rows = listed.json() as Array<{ id: string }> | { data: Array<{ id: string }> };
    const invoices = Array.isArray(rows) ? rows : rows.data;
    expect(invoices.some((r) => r.id === id)).toBe(true);

    const other = await app.inject({
      method: 'GET',
      url: '/api/v1/fees/invoices',
      headers: adminHeaders(TENANT_B),
    });
    expect(other.statusCode).toBe(200);
    const otherRows = other.json() as Array<{ id: string }> | { data: Array<{ id: string }> };
    const otherInvoices = Array.isArray(otherRows) ? otherRows : otherRows.data;
    expect(otherInvoices.some((r) => r.id === id)).toBe(false);
  });
});
