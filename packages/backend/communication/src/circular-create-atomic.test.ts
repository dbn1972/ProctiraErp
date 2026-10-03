/**
 * PRC-M193: circular creation is atomic, de-duplicated and bounded.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { MAX_CIRCULAR_RECIPIENTS } from './circular-schemas.js';
import { InMemoryCircularStore } from './circular-store.js';
import { registerCircularRoutes } from './circulars-routes.js';
import { CircularsService } from './circulars-service.js';

const TENANT_ID = randomUUID();

async function appWith(store: InMemoryCircularStore) {
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
    (request as FastifyRequest & { user?: { sub: string; roles: string[] } }).user = {
      sub: 'comms-staff',
      roles: ['communications_officer'],
    };
  });
  await registerCircularRoutes(app, { circularsService: new CircularsService(store) });
  await app.ready();
  return app;
}

const payload = (recipientIds: string[]) => ({
  title: 'T',
  body: 'B',
  audienceType: 'all',
  requiresAck: true,
  recipientIds,
});

describe('PRC-M193 circular creation', () => {
  it('duplicate recipientIds are de-duplicated -> 201', async () => {
    const app = await appWith(new InMemoryCircularStore());
    const res = await app.inject({
      method: 'POST',
      url: '/communication/circulars',
      payload: payload(['r1', 'r1', 'r2']),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().ackTotal).toBe(2);
  });

  it('failure on ack insert rolls back the circular', async () => {
    const store = new InMemoryCircularStore();
    store.failAckInsert = true;
    const svc = new CircularsService(store);
    await expect(svc.createCircular(TENANT_ID, payload(['r1']) as never)).rejects.toThrow();
    expect(await store.listCirculars(TENANT_ID)).toHaveLength(0);
  });

  it('more than MAX_CIRCULAR_RECIPIENTS recipients -> 400', async () => {
    const app = await appWith(new InMemoryCircularStore());
    const ids = Array.from({ length: MAX_CIRCULAR_RECIPIENTS + 1 }, (_, i) => `r${i}`);
    const res = await app.inject({
      method: 'POST',
      url: '/communication/circulars',
      payload: payload(ids),
    });
    expect(res.statusCode).toBe(400);
  });
});
