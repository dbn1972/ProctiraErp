/**
 * PRC-L126 — GET /institutions validates its query (400 VALIDATION_ERROR, never a Prisma 500).
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryInstitutionRepository } from './in-memory-repository.js';
import { InstitutionService } from './institution-service.js';
import { registerInstitutionRoutes } from './routes.js';

const TENANT_ID = randomUUID();

describe('PRC-L126 institution list query validation', () => {
  let app: FastifyInstance;
  let service: InstitutionService;

  beforeEach(async () => {
    app = Fastify();
    service = new InstitutionService(new InMemoryInstitutionRepository());
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT_ID;
    });
    await registerInstitutionRoutes(app, { institutionService: service });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  const get = (qs: string) => app.inject({ method: 'GET', url: `/institutions?${qs}` });

  it.each([
    ['areaId=notauuid'],
    ['status=BOGUS'],
    ['page=0'],
    ['page=abc'],
    ['sortBy=password'],
    ['sortOrder=sideways'],
    [`search=${'x'.repeat(101)}`],
  ])('returns 400 for %s without calling the service', async (qs) => {
    const spy = vi.spyOn(service, 'list');
    const res = await get(qs);
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(spy).not.toHaveBeenCalled();
  });

  it('coerces numeric strings and forwards validated values', async () => {
    const spy = vi.spyOn(service, 'list');
    const areaId = randomUUID();
    const res = await get(
      `page=2&pageSize=5&areaId=${areaId}&status=ACTIVE&sortBy=code&sortOrder=desc`,
    );
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith(
      TENANT_ID,
      { areaId, status: 'ACTIVE', search: undefined },
      { page: 2, pageSize: 5, sortBy: 'code', sortOrder: 'desc' },
    );
  });
});
