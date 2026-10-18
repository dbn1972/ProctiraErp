/**
 * PRC-M391 — config.branding / locale / security are allowlisted on tenant
 * create AND update. Unknown nested keys and out-of-range values are rejected;
 * a fully-valid config is accepted.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryTenantRepository } from './in-memory-repository.js';
import { registerTenantRoutes } from './routes.js';
import { RecordingAdminProvisioner } from './test-admin-provisioner.js';
import { TenantService } from './tenant-service.js';

const validLocale = {
  defaultLocale: 'en',
  supportedLocales: ['en', 'hi'],
  timezone: 'Asia/Kolkata',
};

describe('tenant config allowlist (PRC-M391)', () => {
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
        slug: 'school-allow',
        admin: { firstName: 'A', lastName: 'B', email: 'a@b.org', password: 'SecureP@ss123' },
      },
    });
    expect(res.statusCode).toBe(201);
    tenantId = res.json().id;
  });

  const post = (payload: unknown) => app.inject({ method: 'POST', url: '/tenants', payload });
  const putTenant = (payload: unknown) =>
    app.inject({ method: 'PUT', url: `/tenants/${tenantId}`, payload });
  const putConfig = (payload: unknown) =>
    app.inject({ method: 'PUT', url: `/tenants/${tenantId}/config`, payload });

  it('rejects unknown nested key under config.branding on CREATE', async () => {
    const res = await post({
      name: 'X',
      slug: 'x-brand',
      admin: { firstName: 'A', lastName: 'B', email: 'a@x.org', password: 'SecureP@ss123' },
      config: { branding: { organizationName: 'X', rogue: 'nope' } },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unknown nested key under config.locale on UPDATE', async () => {
    expect(
      (await putTenant({ config: { locale: { ...validLocale, rogue: 'nope' } } })).statusCode,
    ).toBe(400);
  });

  it('rejects unknown nested key under config.security on config UPDATE', async () => {
    expect((await putConfig({ security: { mfaRequired: true, rogue: 1 } })).statusCode).toBe(400);
  });

  it('rejects out-of-range security.sessionTimeoutMinutes', async () => {
    expect((await putConfig({ security: { sessionTimeoutMinutes: 99999 } })).statusCode).toBe(400);
  });

  it('rejects out-of-range security.passwordMinLength', async () => {
    expect((await putConfig({ security: { passwordMinLength: 2 } })).statusCode).toBe(400);
  });

  it('accepts a fully-valid branding + locale + security config', async () => {
    const res = await putConfig({
      branding: { organizationName: 'Acme', primaryColor: '#123456' },
      locale: validLocale,
      security: { mfaRequired: true, sessionTimeoutMinutes: 60, passwordMinLength: 16 },
    });
    expect(res.statusCode).toBe(200);
    const config = res.json();
    expect(config.security.sessionTimeoutMinutes).toBe(60);
    expect(config.branding.primaryColor).toBe('#123456');
  });
});
