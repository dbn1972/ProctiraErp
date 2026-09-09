/**
 * G-922 circular routes.
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryCircularStore } from './circular-store.js';
import { registerCircularRoutes } from './circulars-routes.js';
import { CircularsService } from './circulars-service.js';

const TENANT_ID = randomUUID();

describe('Circular routes (G-922)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    const circularsService = new CircularsService(new InMemoryCircularStore());
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
    });
    await registerCircularRoutes(app, { circularsService });
    await app.ready();
  });

  it('creates, sends, and acks a circular', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/communication/circulars',
      payload: {
        title: 'Exam timetable',
        body: 'Please acknowledge.',
        audienceType: 'roles',
        audienceIds: ['teacher'],
        requiresAck: true,
        channels: ['whatsapp'],
        recipientIds: ['r1'],
      },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;

    const sent = await app.inject({ method: 'POST', url: `/communication/circulars/${id}/send` });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().status).toBe('sent');

    const acked = await app.inject({
      method: 'POST',
      url: `/communication/circulars/${id}/ack`,
      payload: { recipientId: 'r1' },
    });
    expect(acked.statusCode).toBe(200);
    expect(acked.json().ackRate).toBe(1);

    const logs = await app.inject({ method: 'GET', url: '/communication/delivery-log?channel=whatsapp' });
    expect(logs.statusCode).toBe(200);
    expect(logs.json().data.length).toBeGreaterThan(0);
  });

  it('returns 400 without tenant', async () => {
    const noTenant = Fastify();
    await registerCircularRoutes(noTenant, {
      circularsService: new CircularsService(new InMemoryCircularStore()),
    });
    await noTenant.ready();
    const response = await noTenant.inject({ method: 'GET', url: '/communication/circulars' });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('TENANT_REQUIRED');
  });
});
