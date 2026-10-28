/**
 * PRC-M132 — public branding endpoint for SSR first paint.
 *
 * Base: no backend served any published-theme path, so SSR always rendered the platform
 * default brand. The new endpoint must resolve the tenant only from the verified Host.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import type { PublicBrandingRecord } from './public-branding.js';
import { PublicRegistrationThrottle } from './public-throttle.js';
import { RegistrationService } from './registration-service.js';
import { registerRegistrationRoutes } from './routes.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const HOSTS: Record<string, string> = {
  'north.apply.example.edu': TENANT_A,
  'south.apply.example.edu': TENANT_B,
};
const BRANDING: Record<string, PublicBrandingRecord> = {
  [TENANT_A]: {
    slug: 'north',
    name: 'North District',
    tokens: {
      '--tenant-logo': 'url("https://cdn.example.com/north/logo.svg")',
      '--tenant-favicon': 'url("/favicon-north.ico")',
      '--tenant-primary': '#123456',
      '--tenant-accent': 'hsl(174, 62%, 40%)',
      '--tenant-login-bg': 'url("https://cdn.example.com/bg.png")',
      '--tenant-internal-note': 'not for the public',
      adminEmail: 'admin@north.example',
    },
  },
  [TENANT_B]: { slug: 'south', name: 'South District', tokens: null },
};

async function build(
  opts: { defaultTenantId?: string; throttle?: PublicRegistrationThrottle } = {},
): Promise<FastifyInstance> {
  const app = Fastify();
  await registerRegistrationRoutes(app, {
    registrationService: new RegistrationService(new InMemoryRegistrationRepository()),
    publicTenantResolver: {
      resolveHostname: async (host) => (host ? (HOSTS[host] ?? null) : null),
    },
    defaultTenantId: opts.defaultTenantId,
    publicThrottle: opts.throttle,
    brandingSource: async (tenantId) => BRANDING[tenantId] ?? null,
  });
  await app.ready();
  return app;
}

describe('PRC-M132: GET /registrations/branding', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('returns only the allow-listed fields for the Host-mapped tenant', async () => {
    app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/registrations/branding',
      headers: { host: 'north.apply.example.edu' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      slug: 'north',
      name: 'North District',
      logoUrl: 'https://cdn.example.com/north/logo.svg',
      faviconUrl: '/favicon-north.ico',
      primaryColor: '#123456',
      accentColor: 'hsl(174, 62%, 40%)',
    });
    expect(res.headers['vary']).toMatch(/host/i);
  });

  it('a matching slug is accepted', async () => {
    app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/registrations/branding?slug=north',
      headers: { host: 'north.apply.example.edu' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().slug).toBe('north');
  });

  it("Host mapped to tenant A with ?slug=<tenant B's slug> -> 404", async () => {
    app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/registrations/branding?slug=south',
      headers: { host: 'north.apply.example.edu' },
    });
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain('South');
  });

  it('no verified host mapping -> 404, and a spoofed x-tenant-id is ignored', async () => {
    app = await build();
    const res = await app.inject({
      method: 'GET',
      url: '/registrations/branding?slug=north',
      headers: { host: 'unknown.example.org', 'x-tenant-id': TENANT_A },
    });
    expect(res.statusCode).toBe(404);
  });

  it('the non-production default-tenant fallback never serves branding', async () => {
    app = await build({ defaultTenantId: TENANT_A });
    const res = await app.inject({
      method: 'GET',
      url: '/registrations/branding',
      headers: { host: 'unknown.example.org' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('the 61st request in the window -> 429', async () => {
    app = await build({ throttle: new PublicRegistrationThrottle() });
    for (let i = 0; i < 60; i += 1) {
      const ok = await app.inject({
        method: 'GET',
        url: '/registrations/branding',
        headers: { host: 'north.apply.example.edu' },
      });
      expect(ok.statusCode).toBe(200);
    }
    const limited = await app.inject({
      method: 'GET',
      url: '/registrations/branding',
      headers: { host: 'north.apply.example.edu' },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });

  it('defaults to the root tenantService decorator when no source is injected', async () => {
    const fastify = Fastify();
    fastify.decorate('tenantService', {
      getTenantById: async (id: string) => {
        if (id !== TENANT_A) throw new Error('not found');
        return { slug: 'north', name: 'North', config: { branding: { organizationName: 'NDSB' } } };
      },
      getActiveBranding: async () => ({ tokens: { '--tenant-primary': '#abcdef' } }),
    });
    await registerRegistrationRoutes(fastify, {
      registrationService: new RegistrationService(new InMemoryRegistrationRepository()),
      publicTenantResolver: { resolveHostname: async (h) => (h ? (HOSTS[h] ?? null) : null) },
    });
    await fastify.ready();
    app = fastify;
    const res = await fastify.inject({
      method: 'GET',
      url: '/registrations/branding',
      headers: { host: 'north.apply.example.edu' },
    });
    expect(res.json()).toEqual({ slug: 'north', name: 'NDSB', primaryColor: '#abcdef' });
  });
});
