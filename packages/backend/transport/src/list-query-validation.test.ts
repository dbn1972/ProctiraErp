/**
 * PRC-L390: transport list endpoints validate their querystring.
 *
 * Unbounded pageSize, non-positive / fractional page values and malformed UUID
 * filters must be rejected with 400 instead of reaching the repository (where a
 * malformed UUID raised a PG cast error -> 500).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryTransportRepository } from './in-memory-repository.js';
import { transportPlugin } from './transport-plugin.js';

describe('transport list query validation (PRC-L390)', () => {
  let app: FastifyInstance;
  const tenantId = '550e8400-e29b-41d4-a716-446655440000';

  beforeEach(async () => {
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      const r = request as { tenantId?: string; user?: { sub: string; roles: string[] } };
      r.tenantId = tenantId;
      r.user = { sub: 'officer-1', roles: ['transport_officer'] };
    });
    await app.register(transportPlugin, { repository: new InMemoryTransportRepository() });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    '/transport/routes?pageSize=500',
    '/transport/routes?page=0',
    '/transport/routes?pageSize=1.5',
    '/transport/routes?institutionId=bad',
    '/transport/vehicles?pageSize=101',
    '/transport/driver-assignments?vehicleId=x',
    '/transport/driver-assignments?page=-1',
    '/transport/student-assignments?routeId=not-a-uuid',
    '/transport/student-assignments?studentId=123',
  ])('GET %s -> 400 VALIDATION_ERROR', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
  });

  it('accepts valid paging and echoes it in meta', async () => {
    const res = await app.inject({ method: 'GET', url: '/transport/vehicles?page=2&pageSize=5' });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toMatchObject({ page: 2, pageSize: 5 });
  });

  it('keeps platform defaults when paging is omitted', async () => {
    const res = await app.inject({ method: 'GET', url: '/transport/routes' });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toMatchObject({ page: 1, pageSize: 20 });
  });

  it('accepts well-formed UUID filters', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440001';
    const urls = [
      `/transport/routes?institutionId=${id}`,
      `/transport/driver-assignments?vehicleId=${id}&isActive=true`,
      `/transport/student-assignments?studentId=${id}&routeId=${id}`,
    ];
    for (const url of urls) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
    }
  });
});
