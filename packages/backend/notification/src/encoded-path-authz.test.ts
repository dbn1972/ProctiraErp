/**
 * Staff-only notification surfaces (/send, /rules, /templates) are chosen from the path. The
 * guard used the raw request.url, but Fastify routes on the percent-decoded path — so
 * `/notifications/%73end` reached the broadcast handler while the guard classified it as the
 * self-service action any authenticated user holds. It now classifies by the matched route.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import { NotificationService } from './notification-service.js';
import { registerNotificationRoutes } from './routes.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';

describe('notification staff guard vs percent-encoded paths', () => {
  let app: FastifyInstance;
  let roles: string[] = [];

  beforeEach(async () => {
    roles = [];
    const repository = new InMemoryNotificationRepository();
    const service = new NotificationService(repository);
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId: string }).tenantId = TENANT;
      (request as typeof request & { user?: { sub: string; roles: string[] } }).user = {
        sub: USER,
        roles,
      };
    });
    await registerNotificationRoutes(app, { notificationService: service });
    await app.ready();
  });

  const payload = { channel: 'in_app', recipients: { userIds: [USER] }, body: 'hi' };

  for (const url of ['/notifications/send', '/notifications/%73end']) {
    it(`denies a parent broadcasting via ${url}`, async () => {
      roles = ['parent'];
      const res = await app.inject({ method: 'POST', url, payload });
      expect(res.statusCode).toBe(403);
    });
  }

  for (const url of ['/notifications/rules', '/notifications/%72ules']) {
    it(`denies a student reading rules via ${url}`, async () => {
      roles = ['student'];
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(403);
    });
  }
});
