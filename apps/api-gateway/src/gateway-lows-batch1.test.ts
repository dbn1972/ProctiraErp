/**
 * Gateway low-severity audit gaps, batch 1 (PRC-L001 … PRC-L528).
 * Each describe block maps to one audit row.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { TenantAdminProvisioner } from '@proctira/backend-tenant';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import { providersPlugin, sandboxIdpEnabled } from './plugins/providers-plugin.js';
import { brandingPermissionGranted, tenantAdminPlugin } from './tenant-admin-plugin.js';

delete process.env['DATABASE_URL'];

const testAdminProvisioner: TenantAdminProvisioner = {
  // PRC-H099: the lifecycle refuses to create a tenant without an admin provisioner.
  provisionTenantAdmin: ({ tenantId }) => Promise.resolve({ adminUserId: `admin-of-${tenantId}` }),
};

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_C = '770e8400-e29b-41d4-a716-446655440002';
const TENANT_D = '880e8400-e29b-41d4-a716-446655440003';

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

function headersFor(app: FastifyInstance, roleId: string, tenantId = TENANT_A) {
  return {
    authorization: `Bearer ${app.jwt.sign({
      sub: `${roleId}-1`,
      tenantId,
      email: `${roleId}@example.com`,
      displayName: roleId,
      roles: [{ roleId, roleName: roleId, areaId: null }],
      areas: [],
      institutions: [],
      jti: `jti-${roleId}-${tenantId}`,
      sessionId: `session-${roleId}-${tenantId}`,
    } as never)}`,
    'x-tenant-id': tenantId,
  };
}

describe('gateway lows batch 1', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: config(), tenantAdminProvisioner: testAdminProvisioner });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PRC-L001 /api/v1/meta contract endpoints', () => {
    it('teacher token reads error codes and deprecation policy (200)', async () => {
      for (const url of ['/api/v1/meta/error-codes', '/api/v1/meta/deprecation-policy']) {
        const res = await app.inject({ method: 'GET', url, headers: headersFor(app, 'teacher') });
        expect(res.statusCode, url).toBe(200);
      }
    });

    it('platform admin reads error codes (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/meta/error-codes',
        headers: headersFor(app, 'platform_admin'),
      });
      expect(res.statusCode).toBe(200);
    });

    it('anonymous caller is still rejected (401)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/meta/error-codes' });
      expect(res.statusCode).toBe(401);
    });
  });
  describe('PRC-L003 tenant admin branding shares the lifecycle tenant store', () => {
    it('publish via /api/v1/tenant/branding is visible to the lifecycle TenantService', async () => {
      const tenant = await app.tenantService.createTenant({
        name: 'Shared Store School',
        slug: `shared-store-${Date.now()}`,
        admin: {
          firstName: 'Ada',
          lastName: 'Admin',
          email: 'ada@example.com',
          password: 'correct-horse-battery',
        },
      } as never);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tenant/branding/publish',
        headers: headersFor(app, 'admin', tenant.id),
        payload: { tokens: {}, publishedBy: '11111111-1111-4111-8111-111111111111' },
      });
      expect(res.statusCode, res.body).toBe(201);
      const published = res.json<{ id?: string }>();
      const versions = await app.tenantService.listBrandingVersions(tenant.id);
      expect(versions.length).toBe(1);
      expect(versions[0]!.id).toBe(published.id);
    });
  });
  describe('PRC-L004 branding permission resolver uses the gateway RBAC registry', () => {
    const user = (...roles: unknown[]) => ({ roles });
    const matrix: Array<[string, unknown, boolean, boolean]> = [
      // [label, role, branding:preview, branding:edit]
      ['admin', { roleId: 'admin' }, true, true],
      ['super-admin (canonical id)', { roleId: 'super-admin' }, true, true],
      ['platform_admin', { roleId: 'platform_admin' }, true, true],
      ['super_admin (not an IdP role id)', { roleId: 'super_admin' }, false, false],
      ['tenant_admin (not an IdP role id)', { roleId: 'tenant_admin' }, false, false],
      ['principal', { roleId: 'principal' }, false, false],
      ['teacher', { roleId: 'teacher' }, false, false],
      ['guardian', { roleId: 'guardian' }, false, false],
      [
        'claimed user:manage permission on a non-admin role',
        { roleId: 'teacher', permissions: [{ resource: 'user', action: 'manage' }] },
        false,
        false,
      ],
    ];
    for (const [label, role, preview, edit] of matrix) {
      it(`${label}: preview=${preview} edit=${edit}`, () => {
        expect(brandingPermissionGranted(user(role), 'branding:preview')).toBe(preview);
        expect(brandingPermissionGranted(user(role), 'branding:edit')).toBe(edit);
      });
    }

    it('denies unknown permissions and missing users', () => {
      expect(brandingPermissionGranted(user({ roleId: 'admin' }), 'branding:delete')).toBe(false);
      expect(brandingPermissionGranted(undefined, 'branding:preview')).toBe(false);
      expect(brandingPermissionGranted({ roles: 'admin' }, 'branding:preview')).toBe(false);
    });

    it('admin can save a branding draft through the gateway', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tenant/branding/draft',
        headers: headersFor(app, 'admin'),
        payload: { tokens: {} },
      });
      expect(res.statusCode).not.toBe(403);
    });
  });
  describe('PRC-L205 roles audit records carry the real actor and IP', () => {
    it('invite via /api/v1/tenant/users stores admin sub and client ip', async () => {
      const invited = await app.inject({
        method: 'POST',
        url: '/api/v1/tenant/users',
        headers: headersFor(app, 'admin', TENANT_C),
        remoteAddress: '203.0.113.7',
        payload: { email: 'audit.actor@school.test', displayName: 'Audit Actor', roleIds: [] },
      });
      expect(invited.statusCode, invited.body).toBe(201);
      const logs = await app.auditService.queryAuditLogs({
        tenantId: TENANT_C,
        page: 1,
        pageSize: 100,
      });
      const rolesRecords = logs.data.filter(
        (row) => row.entityType === 'user' && row.afterValues != null,
      );
      expect(rolesRecords.length).toBeGreaterThan(0);
      for (const row of rolesRecords) {
        expect(row.userId).toBe('admin-1');
        expect(row.ipAddress).toBe('203.0.113.7');
      }
    });

    // PRC-M466 supersedes the L205 "still succeeds" behaviour: a high-risk
    // role/user audit failure now fails the request closed (503) by default.
    for (const mode of ['default (fail closed)', 'failOnAuditError=false'] as const) {
      it(`sink failure is logged with the request id — ${mode}`, async () => {
        const lines: string[] = [];
        const bare = Fastify({
          logger: { level: 'error', stream: { write: (line: string) => lines.push(line) } },
        });
        bare.addHook('onRequest', (request, _reply, done) => {
          (request as unknown as { user: unknown }).user = { sub: 'admin-9', tenantId: TENANT_C };
          (request as unknown as { tenantId: string }).tenantId = TENANT_C;
          done();
        });
        await bare.register(tenantAdminPlugin, {
          prefix: '/tenant',
          scimPrefix: false,
          ...(mode === 'failOnAuditError=false' ? { failOnAuditError: false } : {}),
          onAudit: () => {
            throw new Error('audit sink down');
          },
        });
        await bare.ready();
        const res = await bare.inject({
          method: 'POST',
          url: '/tenant/users',
          payload: { email: 'sink.fail@school.test', displayName: 'Sink Fail', roleIds: [] },
        });
        expect(res.statusCode, res.body).toBe(mode === 'failOnAuditError=false' ? 201 : 503);
        const failure = lines
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .find((entry) => entry['msg'] === 'tenant admin audit write failed');
        expect(failure).toBeDefined();
        expect(typeof failure!['requestId']).toBe('string');
        expect(failure!['riskLevel']).toBe('high');
        await bare.close();
      });
    }
  });
  describe('PRC-L208 branding asset staging validates and persists URLs', () => {
    const url = '/api/v1/tenant/branding/assets';

    it('rejects javascript:, data: and http: URLs with 400', async () => {
      for (const bad of [
        'javascript:alert(1)',
        'data:image/svg+xml;base64,PHN2Zz4=',
        'http://cdn.example.com/logo.png',
        'not a url',
      ]) {
        for (const field of ['logoUrl', 'faviconUrl']) {
          const res = await app.inject({
            method: 'POST',
            url,
            headers: headersFor(app, 'admin', TENANT_D),
            payload: { [field]: bad },
          });
          expect(res.statusCode, `${field}=${bad}`).toBe(400);
        }
      }
    });

    it('persists faviconUrl and logoUrl, returned by GET /tenant/settings', async () => {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: headersFor(app, 'admin', TENANT_D),
        payload: {
          logoUrl: 'https://cdn.example.com/logo.png',
          faviconUrl: 'https://cdn.example.com/favicon.ico',
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      const settings = await app.inject({
        method: 'GET',
        url: '/api/v1/tenant/settings',
        headers: headersFor(app, 'admin', TENANT_D),
      });
      expect(settings.statusCode, settings.body).toBe(200);
      const body = settings.json<Record<string, unknown>>();
      const branding = (body['branding'] ??
        (body['data'] as Record<string, unknown> | undefined)?.['branding']) as
        Record<string, unknown> | undefined;
      expect(branding?.['faviconUrl']).toBe('https://cdn.example.com/favicon.ico');
      expect(branding?.['logoUrl']).toBe('https://cdn.example.com/logo.png');
    });

    it('requires branding:edit beyond the gateway user gate', () => {
      expect(brandingPermissionGranted({ roles: [{ roleId: 'admin' }] }, 'branding:edit')).toBe(
        true,
      );
    });
  });
  describe('PRC-L206 sandbox IdP token route', () => {
    const mintUrl = '/api/v1/providers/idp/sandbox/token';

    it('is not mounted in production (404)', async () => {
      const bare = Fastify();
      await bare.register(providersPlugin, {
        prefix: '/api/v1',
        sandboxIdp: sandboxIdpEnabled({ NODE_ENV: 'production' }, 'production'),
      });
      const res = await bare.inject({
        method: 'POST',
        url: mintUrl,
        payload: { subject: 's', tenantId: TENANT_A },
      });
      expect(res.statusCode).toBe(404);
      await bare.close();
    });

    it('enable policy: production off, explicit flag on, non-production on', () => {
      expect(sandboxIdpEnabled({ NODE_ENV: 'production' }, 'production')).toBe(false);
      expect(sandboxIdpEnabled({ NODE_ENV: 'test' }, 'production')).toBe(false);
      expect(sandboxIdpEnabled({ NODE_ENV: 'production', ALLOW_SANDBOX_IDP: '1' })).toBe(true);
      expect(sandboxIdpEnabled({ NODE_ENV: 'test' }, 'test')).toBe(true);
    });

    it('is served only under /api/v1 (not at the server root, outside RBAC)', async () => {
      for (const url of ['/providers/idp/sandbox/token', '/providers/capabilities']) {
        const res = await app.inject({
          method: url.endsWith('token') ? 'POST' : 'GET',
          url,
          headers: headersFor(app, 'guardian'),
          payload: url.endsWith('token') ? { subject: 's', tenantId: TENANT_A } : undefined,
        });
        expect(res.statusCode, url).toBe(404);
      }
      const guardianMint = await app.inject({
        method: 'POST',
        url: mintUrl,
        headers: headersFor(app, 'guardian'),
        payload: { subject: 's', tenantId: TENANT_A },
      });
      expect(guardianMint.statusCode).toBe(403);
    });

    it('rejects roles outside the role catalogue (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: mintUrl,
        headers: headersFor(app, 'super-admin'),
        payload: { subject: 'sandbox-user', tenantId: TENANT_A, roles: ['root'] },
      });
      expect(res.statusCode).toBe(400);
    });

    it('a minted sandbox token is rejected by the gateway (401)', async () => {
      const minted = await app.inject({
        method: 'POST',
        url: mintUrl,
        headers: headersFor(app, 'super-admin'),
        payload: { subject: 'sandbox-user', tenantId: TENANT_A, roles: ['admin'] },
      });
      expect(minted.statusCode, minted.body).toBe(200);
      const { accessToken } = minted.json<{ accessToken: string }>();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/students',
        headers: { authorization: `Bearer ${accessToken}`, 'x-tenant-id': TENANT_A },
      });
      expect(res.statusCode).toBe(401);
    });
  });
  describe('PRC-L398 plugin index exports only mounted plugins', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const appSource = readFileSync(join(here, 'app.ts'), 'utf8');
    const indexSource = readFileSync(join(here, 'plugins/index.ts'), 'utf8');

    it('rate limiting is registered exactly once', () => {
      expect(appSource.match(/register\(rateLimit\b/g) ?? []).toHaveLength(1);
      expect(indexSource).not.toMatch(/rate-limit\.js|request-context\.js|static-assets\.js/);
    });

    it('every module re-exported by plugins/index.ts is imported by app.ts', () => {
      const modules = [...indexSource.matchAll(/from '\.\/([\w-]+)\.js'/g)].map((m) => m[1]!);
      expect(modules.length).toBeGreaterThan(0);
      for (const mod of new Set(modules)) {
        expect(appSource, mod).toContain(`./plugins/${mod}.js`);
      }
    });
  });
});
