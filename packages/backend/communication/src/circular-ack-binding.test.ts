/**
 * PRC-M188: circular acknowledgement is bound to the session (or a linked student).
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryCircularStore } from './circular-store.js';
import { registerCircularRoutes } from './circulars-routes.js';
import { CircularsService } from './circulars-service.js';

const TENANT_ID = randomUUID();

describe('PRC-M188 circular ack binding', () => {
  let app: FastifyInstance;
  let circularId: string;

  beforeEach(async () => {
    app = Fastify();
    const circularsService = new CircularsService(new InMemoryCircularStore());
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
      const sub = String(request.headers['x-test-user'] ?? 'comms-staff');
      (request as FastifyRequest & { user?: { sub: string; roles: string[] } }).user = {
        sub,
        roles: sub === 'comms-staff' ? ['communications_officer'] : ['parent'],
      };
    });
    await registerCircularRoutes(app, {
      circularsService,
      recipientBinding: {
        listLinkedRecipientIds: async (_t, actorId) =>
          actorId === 'guardian-1' ? ['student-1'] : [],
      },
    });
    await app.ready();
    const created = await app.inject({
      method: 'POST',
      url: '/communication/circulars',
      payload: {
        title: 'Trip',
        body: 'Consent',
        audienceType: 'all',
        requiresAck: true,
        recipientIds: ['user-a', 'user-b', 'student-1', 'student-2'],
      },
    });
    circularId = created.json().id as string;
  });

  const ack = (user: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/communication/circulars/${circularId}/ack`,
      headers: { 'x-test-user': user },
      payload,
    });

  it('user A acking recipient B returns 403 and does not ack', async () => {
    const res = await ack('user-a', { recipientId: 'user-b' });
    expect(res.statusCode).toBe(403);
    const view = await app.inject({ method: 'GET', url: `/communication/circulars/${circularId}` });
    expect(view.json().ackCount).toBe(0);
  });

  it('user acks for self from the session', async () => {
    const res = await ack('user-a', {});
    expect(res.statusCode).toBe(200);
    expect(res.json().ackCount).toBe(1);
  });

  it('guardian acks only for own linked student', async () => {
    expect((await ack('guardian-1', { recipientId: 'student-1' })).statusCode).toBe(200);
    expect((await ack('guardian-1', { recipientId: 'student-2' })).statusCode).toBe(403);
  });

  it('response does not reveal whether a foreign recipientId exists', async () => {
    const existing = await ack('user-a', { recipientId: 'user-b' });
    const missing = await ack('user-a', { recipientId: 'nobody-xyz' });
    expect(existing.statusCode).toBe(missing.statusCode);
    expect(existing.body).toBe(missing.body);
    expect(existing.body).not.toContain('user-b');
    const notOnList = await ack('outsider', {});
    expect(notOnList.statusCode).toBe(404);
    expect(notOnList.body).not.toContain('outsider');
  });
});
