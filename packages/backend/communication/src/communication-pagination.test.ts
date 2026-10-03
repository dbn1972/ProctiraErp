/**
 * PRC-M191: communication list routes are bounded and circular lists avoid N+1.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryCircularStore } from './circular-store.js';
import { registerCircularRoutes } from './circulars-routes.js';
import { CircularsService } from './circulars-service.js';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from './pagination.js';

const TENANT_ID = randomUUID();

describe('PRC-M191 communication pagination', () => {
  let app: FastifyInstance;
  let store: InMemoryCircularStore;

  beforeEach(async () => {
    store = new InMemoryCircularStore();
    app = Fastify();
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
  });

  it('5k delivery rows -> default response <= limit with next cursor', async () => {
    const base = Date.now();
    for (let i = 0; i < 5000; i += 1) {
      const at = new Date(base - i * 1000);
      await store.createDeliveryLog({
        id: randomUUID(),
        tenantId: TENANT_ID,
        channel: 'sms',
        recipientId: `r${i}`,
        recipientLabel: null,
        status: 'sent',
        providerRef: null,
        sourceType: 'campaign',
        sourceId: null,
        errorMessage: null,
        queuedAt: at,
        sentAt: at,
        deliveredAt: null,
        failedAt: null,
        retriedAt: null,
        createdAt: at,
        updatedAt: at,
      });
    }
    const first = await app.inject({ method: 'GET', url: '/communication/delivery-log' });
    expect(first.statusCode).toBe(200);
    expect(first.json().data).toHaveLength(DEFAULT_PAGE_LIMIT);
    const cursor = first.json().nextCursor as string;
    expect(cursor).toBeTruthy();
    const second = await app.inject({
      method: 'GET',
      url: `/communication/delivery-log?limit=${MAX_PAGE_LIMIT}&cursor=${cursor}`,
    });
    expect(second.json().data).toHaveLength(MAX_PAGE_LIMIT);
    expect(second.json().data[0].recipientId).toBe(`r${DEFAULT_PAGE_LIMIT}`);
    const over = await app.inject({
      method: 'GET',
      url: `/communication/delivery-log?limit=${MAX_PAGE_LIMIT + 1}`,
    });
    expect(over.statusCode).toBe(400);
  });

  it('list circulars issues one ack query regardless of row count', async () => {
    for (let i = 0; i < 12; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/communication/circulars',
        payload: {
          title: `C${i}`,
          body: 'B',
          audienceType: 'all',
          requiresAck: true,
          recipientIds: ['a', 'b'],
        },
      });
    }
    store.ackQueries = 0;
    const res = await app.inject({ method: 'GET', url: '/communication/circulars?limit=10' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(10);
    expect(res.json().data[0].ackTotal).toBe(2);
    expect(res.json().data[0].acks).toEqual([]);
    expect(res.json().nextCursor).toBe('10');
    expect(store.ackQueries).toBe(1);
  });
});
