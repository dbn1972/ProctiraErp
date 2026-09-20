import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { RegistrationService } from './registration-service.js';
import { registerRegistrationRoutes } from './routes.js';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INSTITUTION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTITUTION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONFIG_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONFIG_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function submission(institutionId = INSTITUTION_A, configurationId = CONFIG_A) {
  return {
    institutionId,
    formConfigurationId: configurationId,
    formConfigurationVersion: 1,
    firstName: 'Ada',
    lastName: 'Lovelace',
    dateOfBirth: '2012-01-01',
    gender: 'female',
    guardianName: 'Parent Lovelace',
    guardianPhone: '+1 555 0100',
  };
}

describe('public registration tenant boundary and idempotency', () => {
  let app: FastifyInstance;
  let repository: InMemoryRegistrationRepository;

  beforeEach(async () => {
    repository = new InMemoryRegistrationRepository();
    repository.seedInstitutions([
      {
        id: INSTITUTION_A,
        tenantId: TENANT_A,
        name: 'Tenant A School',
        code: 'A-1',
        typeId: 'primary',
        areaId: 'area-a',
        status: 'ACTIVE',
        latitude: null,
        longitude: null,
        address: null,
      },
      {
        id: INSTITUTION_B,
        tenantId: TENANT_B,
        name: 'Tenant B School',
        code: 'B-1',
        typeId: 'primary',
        areaId: 'area-b',
        status: 'ACTIVE',
        latitude: null,
        longitude: null,
        address: null,
      },
    ]);
    repository.seedFormConfigurations([
      {
        id: CONFIG_A,
        tenantId: TENANT_A,
        institutionId: INSTITUTION_A,
        version: 1,
        publishedAt: '2026-09-19T00:00:00.000Z',
        fields: [],
      },
      {
        id: CONFIG_B,
        tenantId: TENANT_B,
        institutionId: INSTITUTION_B,
        version: 1,
        publishedAt: '2026-09-19T00:00:00.000Z',
        fields: [],
      },
    ]);

    app = Fastify();
    await registerRegistrationRoutes(app, {
      registrationService: new RegistrationService(repository),
      publicTenantResolver: {
        async resolveHostname(host) {
          if (host === 'a.apply.example') return TENANT_A;
          if (host === 'b.apply.example') return TENANT_B;
          return null;
        },
      },
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('ignores forged x-tenant-id and returns only the Host-resolved tenant', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/registrations/institutions',
      headers: { host: 'a.apply.example', 'x-tenant-id': TENANT_B },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.map((row: { id: string }) => row.id)).toEqual([INSTITUTION_A]);
  });

  it('denies unknown and missing Host with the same non-enumerating response', async () => {
    const unknown = await app.inject({
      method: 'GET',
      url: '/registrations/institutions',
      headers: { host: 'unknown.apply.example' },
    });
    const missing = await app.inject({ method: 'GET', url: '/registrations/institutions' });

    expect(unknown.statusCode).toBe(404);
    expect(missing.statusCode).toBe(404);
    expect(unknown.json()).toEqual(missing.json());
    expect(unknown.json().code).toBe('PUBLIC_REGISTRATION_CONTEXT_NOT_FOUND');
  });

  it('uses raw Host and ignores x-forwarded-host', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/registrations/language',
      headers: {
        host: 'unknown.apply.example',
        'x-forwarded-host': 'a.apply.example',
        'x-tenant-id': TENANT_A,
      },
    });
    expect(response.statusCode).toBe(404);
  });

  it('rejects an institution and config owned by another tenant', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/registrations',
      headers: { host: 'a.apply.example', 'idempotency-key': 'cross-tenant-key' },
      payload: submission(INSTITUTION_B, CONFIG_B),
    });
    expect(response.statusCode).toBe(404);
    expect(repository.getAll()).toHaveLength(0);
  });

  it('does not accept a symbolic institution type as a config lookup key', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/registrations/form-config/primary',
      headers: { host: 'a.apply.example' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errors[0].field).toBe('institutionId');
  });

  it('returns the same result on retry and conflicts on changed payload', async () => {
    const request = {
      method: 'POST' as const,
      url: '/registrations',
      headers: { host: 'a.apply.example', 'idempotency-key': 'route-retry-key' },
      payload: submission(),
    };
    const first = await app.inject(request);
    const retry = await app.inject(request);
    const changed = await app.inject({
      ...request,
      payload: { ...submission(), guardianPhone: '+1 555 9999' },
    });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(200);
    expect(retry.headers['x-idempotency-replay']).toBe('true');
    expect(retry.json()).toEqual(first.json());
    expect(changed.statusCode).toBe(409);
    expect(changed.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(repository.getAll()).toHaveLength(1);
  });

  it('requires an explicit client submission key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/registrations',
      headers: { host: 'a.apply.example' },
      payload: submission(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errors[0].field).toBe('idempotencyKey');
  });
});

describe('public tenant fallback policy', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('allows an explicit default only outside production', async () => {
    process.env.NODE_ENV = 'test';
    const repository = new InMemoryRegistrationRepository();
    repository.seedInstitutions([
      {
        id: INSTITUTION_A,
        tenantId: TENANT_A,
        name: 'Test fallback school',
        code: 'TEST',
        typeId: 'primary',
        areaId: 'area-a',
        status: 'ACTIVE',
        latitude: null,
        longitude: null,
        address: null,
      },
    ]);
    const app = Fastify();
    await registerRegistrationRoutes(app, {
      registrationService: new RegistrationService(repository),
      defaultTenantId: TENANT_A,
    });
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/registrations/institutions' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data[0].id).toBe(INSTITUTION_A);
    await app.close();
  });

  it('refuses a default tenant in production', async () => {
    process.env.NODE_ENV = 'production';
    const app = Fastify();
    await expect(
      registerRegistrationRoutes(app, {
        registrationService: new RegistrationService(new InMemoryRegistrationRepository()),
        defaultTenantId: TENANT_A,
      }),
    ).rejects.toThrow(/cannot use defaultTenantId/);
    await app.close();
  });
});
