/**
 * PRC-M391: tenant CRUD cannot write `config.theme` and rejects invalid
 * timezone / locale / IP-allowlist values.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { isIpOrCidr } from './config-validation.js';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import { registerTenantRoutes } from './routes.js';
import { TenantService } from './tenant-service.js';
import { RecordingAdminProvisioner } from './test-admin-provisioner.js';

const locale = (over: Record<string, unknown> = {}) => ({
  defaultLocale: 'en',
  supportedLocales: ['en', 'hi'],
  timezone: 'Asia/Kolkata',
  ...over,
});

describe('tenant config validation (PRC-M391)', () => {
  let app: FastifyInstance;
  let tenantId: string;

  beforeEach(async () => {
    const service = new TenantService(
      new InMemoryTenantRepository(),
      undefined,
      new RecordingAdminProvisioner(),
    );
    app = Fastify();
    await registerTenantRoutes(app, { tenantService: service });
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/tenants',
      payload: {
        name: 'School',
        slug: 'school-m391',
        admin: { firstName: 'A', lastName: 'B', email: 'a@b.org', password: 'SecureP@ss123' },
      },
    });
    expect(res.statusCode).toBe(201);
    tenantId = res.json().id;
  });

  const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url, payload });

  it('PUT /tenants/:id with config.theme -> 400', async () => {
    const res = await put(`/tenants/${tenantId}`, { config: { theme: { '--x': 'red' } } });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /tenants/:id/config with theme -> 400', async () => {
    const res = await put(`/tenants/${tenantId}/config`, { theme: { '--x': 'red' } });
    expect(res.statusCode).toBe(400);
  });

  it("ipWhitelist ['x'] -> 400; valid CIDRs accepted", async () => {
    expect(
      (await put(`/tenants/${tenantId}/config`, { security: { ipWhitelist: ['x'] } })).statusCode,
    ).toBe(400);
    expect(
      (
        await put(`/tenants/${tenantId}/config`, {
          security: { ipWhitelist: ['10.0.0.0/8', '192.168.1.5', '2001:db8::/32'] },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('invalid timezone or defaultLocale outside supportedLocales -> 400', async () => {
    expect(
      (await put(`/tenants/${tenantId}/config`, { locale: locale({ timezone: 'Mars/Base' }) }))
        .statusCode,
    ).toBe(400);
    expect(
      (await put(`/tenants/${tenantId}/config`, { locale: locale({ defaultLocale: 'fr' }) }))
        .statusCode,
    ).toBe(400);
    expect((await put(`/tenants/${tenantId}/config`, { locale: locale() })).statusCode).toBe(200);
  });

  it('isIpOrCidr bounds the prefix length', () => {
    expect(isIpOrCidr('10.0.0.0/33')).toBe(false);
    expect(isIpOrCidr('::1/128')).toBe(true);
    expect(isIpOrCidr('1.2.3.4/8/1')).toBe(false);
  });
});
