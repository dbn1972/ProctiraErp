/**
 * PRC-L321 — POST /academic-periods/:id/supersede corrects a period window via
 * an append-only successor (success 201, overlap 409, cross-tenant 404).
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAcademicsDeps } from '../academics-factory.js';
import { InMemoryInstitutionRepository } from '../in-memory-repository.js';
import { institutionPlugin } from '../institution-plugin.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

describe('PRC-L321 academic period supersede route', () => {
  let app: FastifyInstance;
  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
  beforeEach(async () => {
    const repository = new InMemoryInstitutionRepository();
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      const header = request.headers['x-tenant-id'];
      (request as unknown as { tenantId: string }).tenantId =
        typeof header === 'string' ? header : TENANT_A;
    });
    await app.register(institutionPlugin, {
      repository,
      academics: createAcademicsDeps({ institutionRepository: repository }),
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  async function createYear() {
    const res = await app.inject({
      method: 'POST',
      url: '/academic-periods',
      payload: { name: 'AY 26', code: 'AY26', startDate: '2026-04-01', endDate: '2027-03-31' },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  const supersede = (id: string, payload: Record<string, unknown>, tenant = TENANT_A) =>
    app.inject({
      method: 'POST',
      url: `/academic-periods/${id}/supersede`,
      headers: { 'x-tenant-id': tenant },
      payload,
    });

  it('appends a successor with the corrected window and archives the prior', async () => {
    const id = await createYear();
    const res = await supersede(id, {
      name: 'AY 26 (corrected)',
      startDate: '2027-04-01',
      endDate: '2028-03-31',
    });
    expect(res.statusCode).toBe(201);
    const successor = res.json();
    expect(successor.id).not.toBe(id);
    expect(successor.code).toBe('AY26');
    expect(successor.startDate).toBe('2027-04-01');
    const prior = await app.inject({ method: 'GET', url: `/academic-periods/${id}` });
    expect(prior.json().status).toBe('archived');
  });

  it('returns 409 when the successor window overlaps the prior version', async () => {
    const id = await createYear();
    const res = await supersede(id, {
      name: 'Overlap',
      startDate: '2026-06-01',
      endDate: '2027-05-31',
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 404 for a period of another tenant and for malformed ids', async () => {
    const id = await createYear();
    const foreign = await supersede(
      id,
      { name: 'x', startDate: '2027-04-01', endDate: '2028-03-31' },
      TENANT_B,
    );
    expect(foreign.statusCode).toBe(404);
    const prior = await app.inject({ method: 'GET', url: `/academic-periods/${id}` });
    expect(prior.json().status).toBe('active');
    const malformed = await supersede('not-a-uuid', {
      name: 'x',
      startDate: '2027-04-01',
      endDate: '2028-03-31',
    });
    expect(malformed.statusCode).toBe(404);
  });

  it('returns 400 for an invalid body', async () => {
    const id = await createYear();
    const res = await supersede(id, { name: '', startDate: 'soon' });
    expect(res.statusCode).toBe(400);
  });
});
