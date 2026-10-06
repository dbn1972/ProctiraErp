/**
 * Owner decision (PR #548): staff may record a circular acknowledgement on
 * behalf of a recipient — admin-only, with a REQUIRED reason and an audit row
 * naming the acting staff member. Normal acks stay bound to the session
 * (self or linked student, PRC-M188).
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { ACK_ON_BEHALF_REASON_MAX } from './circular-schemas.js';
import { InMemoryCircularStore } from './circular-store.js';
import { registerCircularRoutes } from './circulars-routes.js';
import { CircularsService, type CircularAuditEvent } from './circulars-service.js';

const TENANT_ID = randomUUID();

const USERS: Record<string, string[]> = {
  'school-admin': ['admin'],
  principal: ['principal'],
  'comms-officer': ['communications_officer'],
  'guardian-1': ['parent'],
  'user-a': ['parent'],
};

describe('Circular ack on behalf (admin, reason, audit)', () => {
  let app: FastifyInstance;
  let service: CircularsService;
  let sunk: CircularAuditEvent[];
  let circularId: string;

  beforeEach(async () => {
    sunk = [];
    service = new CircularsService(new InMemoryCircularStore(), {
      auditSink: (event) => {
        sunk.push(event);
      },
    });
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId: string }).tenantId = TENANT_ID;
      const sub = String(request.headers['x-test-user'] ?? 'school-admin');
      (request as FastifyRequest & { user?: { sub: string; roles: string[] } }).user = {
        sub,
        roles: USERS[sub] ?? [],
      };
    });
    await registerCircularRoutes(app, {
      circularsService: service,
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
        title: 'Trip consent',
        body: 'Please acknowledge.',
        audienceType: 'all',
        requiresAck: true,
        recipientIds: ['user-a', 'user-b', 'student-1', 'student-2'],
      },
    });
    expect(created.statusCode).toBe(201);
    circularId = created.json().id as string;
  });

  const onBehalf = (user: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/communication/circulars/${circularId}/ack-on-behalf`,
      headers: { 'x-test-user': user },
      payload,
    });
  const ack = (user: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/communication/circulars/${circularId}/ack`,
      headers: { 'x-test-user': user },
      payload,
    });
  const ackCount = async () =>
    (await app.inject({ method: 'GET', url: `/communication/circulars/${circularId}` })).json()
      .ackCount as number;

  it('non-admin staff on-behalf → 403, nothing acked, no audit', async () => {
    const res = await onBehalf('comms-officer', { recipientId: 'user-b', reason: 'Paper slip' });
    expect(res.statusCode).toBe(403);
    expect(await ackCount()).toBe(0);
    expect(sunk).toHaveLength(0);
    expect(service.localAuditLog).toHaveLength(0);
  });

  it('portal user on-behalf → 403', async () => {
    const res = await onBehalf('guardian-1', { recipientId: 'student-1', reason: 'Paper slip' });
    expect(res.statusCode).toBe(403);
    expect(await ackCount()).toBe(0);
  });

  it('missing / blank / oversized reason → 400 and nothing recorded', async () => {
    expect((await onBehalf('school-admin', { recipientId: 'user-b' })).statusCode).toBe(400);
    expect(
      (await onBehalf('school-admin', { recipientId: 'user-b', reason: '   ' })).statusCode,
    ).toBe(400);
    expect(
      (
        await onBehalf('school-admin', {
          recipientId: 'user-b',
          reason: 'x'.repeat(ACK_ON_BEHALF_REASON_MAX + 1),
        })
      ).statusCode,
    ).toBe(400);
    expect((await onBehalf('school-admin', { reason: 'Paper slip' })).statusCode).toBe(400);
    expect(await ackCount()).toBe(0);
    expect(sunk).toHaveLength(0);
  });

  it('admin with reason → 200 and an audit row naming actor, recipient, circular, reason', async () => {
    const res = await onBehalf('school-admin', {
      recipientId: 'user-b',
      reason: '  Signed paper slip returned  ',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ackCount).toBe(1);
    expect(sunk).toHaveLength(1);
    expect(sunk[0]).toMatchObject({
      action: 'circular.ack_on_behalf',
      tenantId: TENANT_ID,
      resourceId: circularId,
      actorId: 'school-admin',
      recipientId: 'user-b',
      reason: 'Signed paper slip returned',
    });
    expect(service.localAuditLog).toEqual(sunk);
    // Re-recording an already acknowledged recipient is a no-op (no second audit).
    expect((await onBehalf('principal', { recipientId: 'user-b', reason: 'dup' })).statusCode).toBe(
      200,
    );
    expect(sunk).toHaveLength(1);
  });

  it('a failing durable audit sink fails the request and records no ack', async () => {
    const failing = new CircularsService(new InMemoryCircularStore(), {
      auditSink: () => {
        throw new Error('audit store down');
      },
    });
    const created = await failing.createCircular(TENANT_ID, {
      title: 'T',
      body: 'B',
      audienceType: 'all',
      requiresAck: true,
      recipientIds: ['user-b'],
    } as never);
    await expect(
      failing.ackCircularOnBehalf(TENANT_ID, created.id, 'user-b', {
        actorId: 'school-admin',
        reason: 'Paper slip',
      }),
    ).rejects.toThrow('audit store down');
    expect((await failing.getCircular(TENANT_ID, created.id)).ackCount).toBe(0);
  });

  it('normal self-ack still works without a reason or audit', async () => {
    const res = await ack('user-a', {});
    expect(res.statusCode).toBe(200);
    expect(res.json().ackCount).toBe(1);
    expect(sunk).toHaveLength(0);
  });

  it('normal ack for a non-linked recipient (no on-behalf) → 403, even for an admin', async () => {
    expect((await ack('guardian-1', { recipientId: 'student-2' })).statusCode).toBe(403);
    expect((await ack('school-admin', { recipientId: 'user-b' })).statusCode).toBe(403);
    expect((await ack('comms-officer', { recipientId: 'user-b' })).statusCode).toBe(403);
    expect(await ackCount()).toBe(0);
    // linked student still allowed on the normal path
    expect((await ack('guardian-1', { recipientId: 'student-1' })).statusCode).toBe(200);
  });
});
