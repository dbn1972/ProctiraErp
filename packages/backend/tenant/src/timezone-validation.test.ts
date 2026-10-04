/**
 * PRC-L358: admin tenant writes reject invalid IANA timezones instead of letting the runtime
 * resolver silently fall back to UTC.
 */
import { ValidationError } from '@proctira/common';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { InMemoryTenantRepository } from './in-memory-repository.js';
import { RecordingAdminProvisioner } from './test-admin-provisioner.js';
import { TenantService } from './tenant-service.js';
import { InMemoryTenantSettingsStore, registerTenantSettingsRoutes } from './tenant-settings.js';
import { isValidTenantTimezone } from './timezone-validation.js';

const TENANT = '00000000-0000-4000-8000-0000000000a1';

describe('tenant timezone validation (PRC-L358)', () => {
  it('accepts exact IANA zones and rejects typos, offsets and padded values', () => {
    for (const zone of ['UTC', 'Asia/Kolkata', 'America/Argentina/Buenos_Aires', 'Etc/GMT+5']) {
      expect(isValidTenantTimezone(zone), zone).toBe(true);
    }
    for (const zone of [
      '',
      ' ',
      'Asia/Calcuta',
      ' Asia/Kolkata',
      '+05:30',
      'IST',
      'Mars/Base',
      1,
    ]) {
      expect(isValidTenantTimezone(zone), String(zone)).toBe(false);
    }
  });

  it('PUT /tenant/settings rejects an invalid timezone and keeps the stored value', async () => {
    const store = new InMemoryTenantSettingsStore();
    const app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
    });
    await registerTenantSettingsRoutes(app, { store, prefix: '/tenant' });
    await app.ready();
    const body = {
      displayName: 'Springfield Board',
      defaultLocale: 'en',
      supportedLocales: ['en'],
      timezone: 'Asia/Calcuta',
      academicYearStartMonth: 4,
      branding: { primaryColor: '#123456', accentColor: '#abcdef', logoUrl: null },
      contact: { email: null, phone: null },
    };
    const rejected = await app.inject({ method: 'PUT', url: '/tenant/settings', payload: body });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().errors).toEqual([
      expect.objectContaining({ field: 'timezone', rule: 'iana_timezone' }),
    ]);
    expect(await store.get(TENANT)).toBeNull();
    const saved = await app.inject({
      method: 'PUT',
      url: '/tenant/settings',
      payload: { ...body, timezone: 'Asia/Kolkata' },
    });
    expect(saved.statusCode).toBe(200);
    expect((await store.get(TENANT))?.timezone).toBe('Asia/Kolkata');
    await app.close();
  });

  it('TenantService.updateConfig rejects an invalid locale.timezone (400) without writing', async () => {
    const repository = new InMemoryTenantRepository();
    const service = new TenantService(repository, undefined, new RecordingAdminProvisioner());
    const tenant = await service.createTenant({
      name: 'Ministry of Education',
      slug: 'ministry-edu-tz',
      plan: 'professional',
      region: 'us-east-1',
      admin: {
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin@ministry-edu.org',
        password: 'SecureP@ss123',
      },
    });
    const attempt = service.updateConfig(tenant.id, {
      locale: { defaultLocale: 'en', supportedLocales: ['en'], timezone: 'Asia/Calcuta' },
    });
    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 400 });
    expect((await service.getConfig(tenant.id)).locale?.timezone).toBe('UTC');
    const ok = await service.updateConfig(tenant.id, {
      locale: { defaultLocale: 'en', supportedLocales: ['en'], timezone: 'Asia/Kolkata' },
    });
    expect(ok.config.locale?.timezone).toBe('Asia/Kolkata');
  });
});
