/**
 * PRC-L124 — calendar events on archived periods are read-only (delete → 409),
 * and repair-request writes are schema-validated.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAcademicsDeps } from '../academics-factory.js';
import { InMemoryInstitutionRepository } from '../in-memory-repository.js';
import {
  InMemoryConditionOptionStore,
  InMemoryInfrastructureStore,
} from '../infrastructure/in-memory-store.js';
import { registerInfrastructureRoutes } from '../infrastructure/routes.js';
import { InfrastructureService } from '../infrastructure/service.js';
import { institutionPlugin } from '../institution-plugin.js';

const TENANT = randomUUID();

describe('PRC-L124 archived calendar delete', () => {
  let app: FastifyInstance;
  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    const repository = new InMemoryInstitutionRepository();
    const deps = createAcademicsDeps({ institutionRepository: repository });
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
    });
    await app.register(institutionPlugin, { repository, academics: deps });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it('returns 409 when deleting an event from an archived period', async () => {
    const year = await app.inject({
      method: 'POST',
      url: '/academic-periods',
      payload: { name: 'AY 26', code: 'AY26', startDate: '2026-04-01', endDate: '2027-03-31' },
    });
    expect(year.statusCode).toBe(201);
    const yearId = year.json().id as string;
    const event = await app.inject({
      method: 'POST',
      url: `/academic-periods/${yearId}/calendar`,
      payload: { kind: 'holiday', name: 'Diwali', startDate: '2026-10-20', endDate: '2026-10-20' },
    });
    expect(event.statusCode).toBe(201);
    const archived = await app.inject({
      method: 'PUT',
      url: `/academic-periods/${yearId}`,
      payload: { status: 'archived' },
    });
    expect(archived.statusCode).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: `/academic-periods/${yearId}/calendar/${event.json().id}`,
    });
    expect(del.statusCode).toBe(409);
    const list = await app.inject({ method: 'GET', url: `/academic-periods/${yearId}/calendar` });
    expect(list.json().data).toHaveLength(1);
  });
});

describe('PRC-L124 repair request validation', () => {
  let app: FastifyInstance;
  const institutionId = '12345678-1234-4234-8234-123456789abc';
  let infrastructureId: string;
  beforeEach(async () => {
    const store = new InMemoryInfrastructureStore();
    const service = new InfrastructureService({
      store,
      conditionStore: new InMemoryConditionOptionStore(),
    });
    const land = await service.createLand({
      name: 'Campus',
      institutionId,
      capacity: 100,
      condition: 'Good',
    });
    infrastructureId = land.id;
    app = Fastify();
    await registerInfrastructureRoutes(app, { infrastructureService: service });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  const post = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/infrastructure/repair-requests', payload });

  it('accepts a valid repair request', async () => {
    const res = await post({ institutionId, infrastructureId, summary: 'Ceiling leak' });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('open');
  });

  it('rejects non-uuid ids, oversize and blank summaries with 400', async () => {
    expect((await post({ institutionId: 'x', infrastructureId, summary: 'a' })).statusCode).toBe(
      400,
    );
    expect(
      (await post({ institutionId, infrastructureId: 'not-a-uuid', summary: 'a' })).statusCode,
    ).toBe(400);
    expect(
      (await post({ institutionId, infrastructureId, summary: 'x'.repeat(2001) })).statusCode,
    ).toBe(400);
    expect((await post({ institutionId, infrastructureId, summary: '   ' })).statusCode).toBe(400);
  });

  it('rejects a non-uuid institutionId on list with 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/infrastructure/repair-requests?institutionId=nope',
    });
    expect(res.statusCode).toBe(400);
  });
});
