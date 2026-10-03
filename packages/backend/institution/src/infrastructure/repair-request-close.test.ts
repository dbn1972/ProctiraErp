/**
 * PRC-L124: close / reopen endpoint for infrastructure repair requests,
 * TypeBox-validated (uuid, maxLength, closed status set).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryConditionOptionStore, InMemoryInfrastructureStore } from './in-memory-store.js';
import { registerInfrastructureRoutes } from './routes.js';
import { InfrastructureService } from './service.js';

const INSTITUTION = '12345678-1234-4234-8234-123456789abc';
const OTHER_INSTITUTION = '22345678-1234-4234-8234-123456789abc';

describe('PRC-L124 repair request close flow', () => {
  let app: FastifyInstance;
  let service: InfrastructureService;
  let repairId: string;

  beforeEach(async () => {
    service = new InfrastructureService({
      store: new InMemoryInfrastructureStore(),
      conditionStore: new InMemoryConditionOptionStore(),
    });
    app = Fastify();
    await registerInfrastructureRoutes(app, { infrastructureService: service });
    await app.ready();
    const land = await service.createLand({
      name: 'Main',
      institutionId: INSTITUTION,
      capacity: 10,
      condition: 'Good',
    });
    const created = await app.inject({
      method: 'POST',
      url: '/infrastructure/repair-requests',
      payload: { institutionId: INSTITUTION, infrastructureId: land.id, summary: 'Leak' },
    });
    expect(created.statusCode).toBe(201);
    repairId = created.json().id as string;
  });

  const patch = (id: string, payload: unknown) =>
    app.inject({ method: 'PATCH', url: `/infrastructure/repair-requests/${id}`, payload });

  it('closes an open request, then 409s on a repeat close, then reopens', async () => {
    const closed = await patch(repairId, { institutionId: INSTITUTION, status: 'closed' });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().status).toBe('closed');
    expect(
      (await patch(repairId, { institutionId: INSTITUTION, status: 'closed' })).statusCode,
    ).toBe(409);
    const list = await app.inject({
      method: 'GET',
      url: `/infrastructure/repair-requests?institutionId=${INSTITUTION}`,
    });
    expect(list.json().data[0].status).toBe('closed');
    const reopened = await patch(repairId, { institutionId: INSTITUTION, status: 'open' });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().status).toBe('open');
  });

  it('404s for another institution (no cross-institution close)', async () => {
    const res = await patch(repairId, { institutionId: OTHER_INSTITUTION, status: 'closed' });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown request id', async () => {
    const res = await patch('00000000-0000-4000-8000-000000000001', {
      institutionId: INSTITUTION,
      status: 'closed',
    });
    expect(res.statusCode).toBe(404);
  });

  it.each([
    ['non-uuid id', 'not-a-uuid', { institutionId: INSTITUTION, status: 'closed' }],
    ['non-uuid institution', null, { institutionId: 'x', status: 'closed' }],
    ['unknown status', null, { institutionId: INSTITUTION, status: 'resolved' }],
    ['extra property', null, { institutionId: INSTITUTION, status: 'closed', note: 'x' }],
    ['missing status', null, { institutionId: INSTITUTION }],
  ])('400 on %s', async (_label, id, payload) => {
    const res = await patch((id as string | null) ?? repairId, payload);
    expect(res.statusCode).toBe(400);
  });
});
