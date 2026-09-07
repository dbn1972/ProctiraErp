/**
 * Communication routes integration tests.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { communicationPlugin } from './communication-plugin.js';
import { InMemoryCommunicationRepository } from './in-memory-repository.js';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const ACTOR_1 = '11111111-1111-4111-8111-111111111111';
const ACTOR_2 = '22222222-2222-4222-8222-222222222222';

describe('Communication Routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as { tenantId: string }).tenantId = TENANT_ID;
    });

    await app.register(communicationPlugin, {
      repository: new InMemoryCommunicationRepository(),
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
      await noTenantApp.register(communicationPlugin, {
        repository: new InMemoryCommunicationRepository(),
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
    it('should require two distinct actors to confirm', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/communication/emergency',
        payload: {
          reason: 'Weather closure',
          channels: ['sms', 'push'],
        },
      });
      const blast = createRes.json();

      const first = await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/confirm`,
        payload: { actorId: ACTOR_1 },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().confirmActor1).toBe(ACTOR_1);
      expect(first.json().status).toBe('pending_confirm');

      const duplicate = await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/confirm`,
        payload: { actorId: ACTOR_1 },
      });
      expect(duplicate.statusCode).toBe(409);

      const second = await app.inject({
        method: 'POST',
        url: `/communication/emergency/${blast.id}/confirm`,
        payload: { actorId: ACTOR_2 },
      });
      expect(second.statusCode).toBe(200);
      expect(second.json().status).toBe('confirmed');
      expect(second.json().confirmActor2).toBe(ACTOR_2);
    });
  });

  describe('POST /communication/audience/preview', () => {
    it('should return an estimated recipient count', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/communication/audience/preview',
        payload: { audienceJson: { scope: 'hostel', hostelId: TENANT_ID } },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.estimatedRecipients).toBeGreaterThan(0);
      expect(body.scope).toBe('hostel');
    });

    it('should estimate all-tenant scope', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/communication/audience/preview',
        payload: { audienceJson: { scope: 'all' } },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().estimatedRecipients).toBe(500);
    });
  });
});
