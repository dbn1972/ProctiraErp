/**
 * PRC-M132 — the public branding endpoint through the real gateway composition: no JWT, the
 * tenant from the Host via the gateway's own verified resolver, `slug` must match.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

function config(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60_000, maxRequests: 1000 },
    cors: { origins: ['http://localhost:3000'], methods: ['GET'], credentials: true },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'apply.example.edu', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  } as GatewayConfig;
}

describe('PRC-M132: GET /api/v1/registrations/branding through the gateway', () => {
  let app: FastifyInstance;
  let tenantId: string;

  beforeAll(async () => {
    app = await buildApp({
      config: config(),
      tenantAdminProvisioner: { provisionTenantAdmin: async () => ({ adminUserId: 'a-1' }) },
    });
    await app.ready();
    const created = await app.tenantService.createTenant({
      name: 'Brand North',
      slug: 'brand-north',
      admin: { email: 'admin@example.com', firstName: 'A', lastName: 'B' },
    } as Parameters<typeof app.tenantService.createTenant>[0]);
    tenantId = created.id;
    await app.tenantService.createTenant({
      name: 'Brand South',
      slug: 'brand-south',
      admin: { email: 'admin2@example.com', firstName: 'A', lastName: 'B' },
    } as Parameters<typeof app.tenantService.createTenant>[0]);
    await app.tenantService.publishBranding(tenantId, {
      tokens: { '--tenant-primary': '#123456' },
      publishedBy: 'admin',
    } as Parameters<typeof app.tenantService.publishBranding>[1]);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('anonymous request with the tenant Host -> 200 with the allow-listed brand', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/registrations/branding?slug=brand-north',
      headers: { host: 'brand-north.apply.example.edu' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ slug: 'brand-north', primaryColor: '#123456' });
  });

  it("another tenant's slug on this Host -> 404", async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/registrations/branding?slug=brand-south',
      headers: { host: 'brand-north.apply.example.edu' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('an unmapped Host with a spoofed tenant header -> 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/registrations/branding?slug=brand-north',
      headers: { host: 'evil.example.org', 'x-tenant-id': tenantId },
    });
    expect(res.statusCode).toBe(404);
  });
});
