/**
 * PRC-M192: communication input validation fails closed.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryCircularStore } from './circular-store.js';
import { communicationPlugin } from './communication-plugin.js';
import { InMemoryCommunicationRepository } from './in-memory-repository.js';

const TENANT_ID = randomUUID();

describe('PRC-M192 communication input validation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId: string }).tenantId = TENANT_ID;
      (request as { user?: { sub: string; roles: string[] } }).user = {
        sub: 'comms-staff',
        roles: ['communications_officer'],
      };
    });
    await app.register(communicationPlugin, {
      repository: new InMemoryCommunicationRepository(),
      circularStore: new InMemoryCircularStore(),
    });
    await app.ready();
  });

  const campaign = (extra: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/communication/campaigns',
      payload: { name: 'N', body: 'B', ...extra },
    });

  it('delivery-log ?status=bogus -> 400', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/communication/delivery-log?status=bogus',
    });
    expect(res.statusCode).toBe(400);
    const ch = await app.inject({ method: 'GET', url: '/communication/delivery-log?channel=xyz' });
    expect(ch.statusCode).toBe(400);
  });

  it("channels ['xyz'] -> 400 on campaigns, emergency and circulars", async () => {
    expect((await campaign({ channels: ['xyz'] })).statusCode).toBe(400);
    const blast = await app.inject({
      method: 'POST',
      url: '/communication/emergency',
      payload: { reason: 'r', channels: ['xyz'] },
    });
    expect(blast.statusCode).toBe(400);
    const circ = await app.inject({
      method: 'POST',
      url: '/communication/circulars',
      payload: { title: 't', body: 'b', audienceType: 'all', channels: ['xyz'] },
    });
    expect(circ.statusCode).toBe(400);
    expect((await campaign({ channels: ['email', 'sms'] })).statusCode).toBe(201);
  });

  it("scheduledAt 'garbage' -> 400; past -> 400; future -> rejected (no scheduler)", async () => {
    expect((await campaign({ scheduledAt: 'garbage' })).statusCode).toBe(400);
    expect((await campaign({ scheduledAt: '2000-01-01T00:00:00Z' })).statusCode).toBe(400);
    const future = await campaign({ scheduledAt: '2999-01-01T00:00:00Z' });
    expect(future.statusCode).toBe(422);
  });

  it('oversized audienceJson -> 400', async () => {
    const res = await campaign({ audienceJson: { ids: 'x'.repeat(20_000) } });
    expect(res.statusCode).toBe(400);
  });
});
