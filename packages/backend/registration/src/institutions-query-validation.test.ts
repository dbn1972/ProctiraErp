/**
 * PRC-L140: GET /registrations/institutions validates its public querystring
 * against InstitutionMapQuerySchema instead of coercing raw values.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryRegistrationRepository } from './in-memory-repository.js';
import { RegistrationService } from './registration-service.js';
import { registerRegistrationRoutes } from './routes.js';

const TENANT = 'tenant-l140';

describe('PRC-L140 institutions query validation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const repo = new InMemoryRegistrationRepository();
    repo.seedInstitutions(
      Array.from({ length: 12 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        tenantId: TENANT,
        name: `School ${i}`,
        code: `S${i}`,
        typeId: 'primary',
        typeName: 'Primary',
        areaId: 'north',
        areaName: 'North',
        status: 'ACTIVE',
        latitude: null,
        longitude: null,
        address: null,
      })),
    );
    app = Fastify();
    await registerRegistrationRoutes(app, {
      registrationService: new RegistrationService(repo),
      defaultTenantId: TENANT,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects pageSize above the schema maximum', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/registrations/institutions?pageSize=500',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });

  it('rejects page below 1', async () => {
    const res = await app.inject({ method: 'GET', url: '/registrations/institutions?page=0' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('rejects a search term longer than 200 characters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/registrations/institutions?search=${'a'.repeat(201)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('converts valid string pagination to numbers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/registrations/institutions?page=2&pageSize=10',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta: { page: number; pageSize: number } };
    expect(body.meta.page).toBe(2);
    expect(body.meta.pageSize).toBe(10);
    expect(body.data).toHaveLength(2);
  });

  it('keeps the defaults when no pagination is sent', async () => {
    const res = await app.inject({ method: 'GET', url: '/registrations/institutions' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[]; meta: { page: number; pageSize: number } };
    expect(body.meta).toMatchObject({ page: 1, pageSize: 50 });
    expect(body.data).toHaveLength(12);
  });
});
