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
      (request as FastifyRequest & { user?: { sub: string; roles: string[] } }).user = {
        sub: 'comms-staff',
        roles: ['communications_officer'],
      };
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
        recipientIds: ['comms-staff'],
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
      payload: {},
    });
    expect(acked.statusCode).toBe(200);
    expect(acked.json().ackRate).toBe(1);

    const logs = await app.inject({
      method: 'GET',
      url: '/communication/delivery-log?channel=whatsapp',
    });
    expect(logs.statusCode).toBe(200);
    expect(logs.json().data.length).toBeGreaterThan(0);
  });

  it('returns 400 without tenant', async () => {
    const noTenant = Fastify();
    noTenant.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { user?: { sub: string; roles: string[] } }).user = {
        sub: 'comms-staff',
        roles: ['communications_officer'],
      };
    });
    await registerCircularRoutes(noTenant, {
      circularsService: new CircularsService(new InMemoryCircularStore()),
    });
    await noTenant.ready();
    const response = await noTenant.inject({ method: 'GET', url: '/communication/circulars' });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('TENANT_REQUIRED');
  });
});

describe('Circular acknowledgement scoping (PRC-M071)', () => {
  let user: { sub: string; roles: string[] };
  let app: FastifyInstance;

  beforeEach(async () => {
    user = { sub: 'comms-staff', roles: ['communications_officer'] };
    app = Fastify();
    const circularsService = new CircularsService(new InMemoryCircularStore());
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
      (request as FastifyRequest & { user?: { sub: string; roles: string[] } }).user = user;
    });
    await registerCircularRoutes(app, { circularsService });
    await app.ready();
  });

  async function sentCircular(): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/communication/circulars',
      payload: {
        title: 'Fee notice',
        body: 'Please acknowledge.',
        audienceType: 'roles',
        audienceIds: ['parent'],
        requiresAck: true,
        channels: ['whatsapp'],
        recipientIds: ['user-a', 'user-b'],
      },
    });
    const id = created.json().id as string;
    await app.inject({ method: 'POST', url: `/communication/circulars/${id}/send` });
    return id;
  }

  it('returns 403 when a portal user acknowledges for another recipient', async () => {
    const id = await sentCircular();
    user = { sub: 'user-a', roles: ['parent'] };
    const res = await app.inject({
      method: 'POST',
      url: `/communication/circulars/${id}/ack`,
      payload: { recipientId: 'user-b' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('lets a portal user acknowledge as themselves', async () => {
    const id = await sentCircular();
    user = { sub: 'user-a', roles: ['parent'] };
    const res = await app.inject({
      method: 'POST',
      url: `/communication/circulars/${id}/ack`,
      payload: { recipientId: 'user-a' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ackCount).toBe(1);
  });

  it('lets communication staff record an acknowledgement on behalf of a recipient', async () => {
    const id = await sentCircular();
    const res = await app.inject({
      method: 'POST',
      url: `/communication/circulars/${id}/ack`,
      payload: { recipientId: 'user-b' },
    });
    expect(res.statusCode).toBe(200);
  });
});
