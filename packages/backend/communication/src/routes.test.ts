/**
 * Communication routes integration tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { InMemoryCircularStore } from './circular-store.js';
import { communicationPlugin } from './communication-plugin.js';
import { InMemoryCommunicationRepository } from './in-memory-repository.js';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ACTOR_1 = '11111111-1111-4111-8111-111111111111';
const ACTOR_2 = '22222222-2222-4222-8222-222222222222';

describe('Communication Routes', () => {
  let app: FastifyInstance;
  // PRC-H045: the acting session identity. Tests switch this to simulate different staff members;
  // the actor is taken from here (request.user.sub), never from the request body.
  let currentUserSub = 'comms-staff';

  beforeEach(async () => {
    currentUserSub = 'comms-staff';
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId: string }).tenantId = TENANT_ID;
      (request as { user?: { sub: string; roles: string[] } }).user = {
        sub: currentUserSub,
        roles: ['communications_officer'],
      };
    });

    await app.register(communicationPlugin, {
      repository: new InMemoryCommunicationRepository(),
      circularStore: new InMemoryCircularStore(),
    });
    await app.ready();
  });

  describe('POST /communication/campaigns', () => {
    it('should create a campaign', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/communication/campaigns',
        payload: {
          name: 'Term opening notice',
          channels: ['email', 'sms'],
          body: 'Welcome back!',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe('Term opening notice');
      expect(body.status).toBe('draft');
    });

    it('should return 400 without tenant', async () => {
      const noTenantApp = Fastify({ logger: false });
      noTenantApp.addHook('onRequest', async (request) => {
        (request as { user?: { sub: string; roles: string[] } }).user = {
          sub: 'comms-staff',
          roles: ['communications_officer'],
        };
      });
      await noTenantApp.register(communicationPlugin, {
        repository: new InMemoryCommunicationRepository(),
        circularStore: new InMemoryCircularStore(),
      });
      await noTenantApp.ready();

      const response = await noTenantApp.inject({
        method: 'GET',
        url: '/communication/campaigns',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('TENANT_REQUIRED');
    });
  });

  describe('GET /communication/campaigns/:id', () => {
    it('should fetch a campaign by id', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/communication/campaigns',
        payload: { name: 'Fetch me' },
      });
      const created = createRes.json();

      const response = await app.inject({
        method: 'GET',
        url: `/communication/campaigns/${created.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(created.id);
    });
  });

  describe('POST /communication/campaigns/:id/send', () => {
    it('should sandbox-send a draft campaign', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/communication/campaigns',
        payload: { name: 'Send me', channels: ['email'] },
      });
      const created = createRes.json();

      const response = await app.inject({
        method: 'POST',
        url: `/communication/campaigns/${created.id}/send`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('sent');
      expect(body.sentAt).toBeTruthy();
      expect(body.delivery.mode).toBe('sandbox');
      expect(body.delivery.honestyNote).toContain('Sandbox');
    });
  });

  describe('POST /communication/emergency/:id/confirm', () => {
    // Create as a dedicated raiser so the two confirmers are distinct from the creator.
    async function createBlastAs(creatorSub: string) {
      currentUserSub = creatorSub;
      const createRes = await app.inject({
        method: 'POST',
        url: '/communication/emergency',
        payload: { reason: 'Weather closure', channels: ['sms', 'push'] },
      });
      return createRes.json();
    }

    it('confirms only with two distinct authenticated sessions', async () => {
      const blast = await createBlastAs('raiser');

      currentUserSub = ACTOR_1;
      const first = await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/confirm`,
        payload: {},
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().confirmActor1).toBe(ACTOR_1);
      expect(first.json().status).toBe('pending_confirm');

      currentUserSub = ACTOR_2;
      const second = await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/confirm`,
        payload: {},
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().status).toBe('confirmed');
      expect(second.json().confirmActor2).toBe(ACTOR_2);
    });

    // PRC-H045: the core exploit — one authenticated user posting two fabricated body actorIds.
    it('rejects a single session confirming twice even with differing body actorIds', async () => {
      const blast = await createBlastAs('raiser');

      currentUserSub = ACTOR_1;
      const first = await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/confirm`,
        payload: { actorId: ACTOR_1 },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().confirmActor1).toBe(ACTOR_1);
      expect(first.json().status).toBe('pending_confirm');

      // Same session, but tries to pass a different actorId in the body — must be ignored.
      const secondSameSession = await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/confirm`,
        payload: { actorId: ACTOR_2 },
      });
      expect(secondSameSession.statusCode).toBe(409);
      // Still only one confirmation recorded.
      expect(first.json().confirmActor2).toBeNull();
    });

    it('accepts a confirm request with no JSON body', async () => {
      const blast = await createBlastAs('raiser');
      currentUserSub = ACTOR_1;
      const res = await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/confirm`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().confirmActor1).toBe(ACTOR_1);
    });

    // PRC-H045: the creator cannot be one of the two confirmers.
    it('rejects the creator confirming their own blast', async () => {
      const blast = await createBlastAs(ACTOR_1);
      currentUserSub = ACTOR_1;
      const res = await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/confirm`,
        payload: {},
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('POST /communication/emergency/:id/dispatch', () => {
    it('should sandbox-dispatch a confirmed blast', async () => {
      currentUserSub = 'raiser';
      const createRes = await app.inject({
        method: 'POST',
        url: '/communication/emergency',
        payload: { reason: 'Fire drill', channels: ['sms'] },
      });
      const blast = createRes.json();
      currentUserSub = ACTOR_1;
      await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/confirm`,
        payload: {},
      });
      currentUserSub = ACTOR_2;
      await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/confirm`,
        payload: {},
      });

      const response = await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/dispatch`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('sent');
      expect(response.json().delivery.mode).toBe('sandbox');
    });
  });

  describe('POST /communication/audience/preview', () => {
    it('should return an audience preview for hostel scope', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/communication/audience/preview',
        payload: { audienceJson: { scope: 'hostel', hostelId: TENANT_ID } },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.scope).toBe('hostel');
      expect(typeof body.estimatedRecipients).toBe('number');
      expect(body.estimatedRecipients).toBeGreaterThanOrEqual(0);
      expect(body.honestyNote).toBeTruthy();
    });

    it('should estimate all-tenant scope', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/communication/audience/preview',
        payload: { audienceJson: { scope: 'all' } },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().estimatedRecipients).toBe(500);
      expect(response.json().source).toBe('estimator');
    });
  });
});
