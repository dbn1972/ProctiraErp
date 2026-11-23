/**
 * PRC-L332 (topic 3 Option A): device deletion checks device ownership, and
 * preference/device bodies are schema-validated.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryNotificationRepository } from './in-memory-repository.js';
import { NotificationService } from './notification-service.js';
import { createPgNotificationPrefsStore, InMemoryNotificationPrefsStore } from './prefs-store.js';
import { registerNotificationRoutes } from './routes.js';
const TENANT = '11111111-1111-4111-8111-111111111111';
const USER_A = '33333333-3333-4333-8333-333333333333';
const USER_B = '44444444-4444-4444-8444-444444444444';
const as = (sub: string) => ({ 'x-test-sub': sub });
describe('PRC-L332 notification devices and preferences', () => {
  let app: FastifyInstance;
  let prefsStore: InMemoryNotificationPrefsStore;
  beforeEach(async () => {
    prefsStore = new InMemoryNotificationPrefsStore();
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId: string }).tenantId = TENANT;
      const sub = request.headers['x-test-sub'];
      (request as typeof request & { user?: unknown }).user = {
        sub: typeof sub === 'string' ? sub : USER_A,
        roles: ['student'],
      };
    });
    await registerNotificationRoutes(app, {
      notificationService: new NotificationService(new InMemoryNotificationRepository()),
      prefsStore,
      prefix: '/notifications',
    });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });
  async function registerFor(sub: string, token: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/notifications/devices',
      headers: as(sub),
      payload: { platform: 'android', pushToken: token },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }
  it("another user in the same tenant cannot delete a user's device (404, device kept)", async () => {
    const deviceId = await registerFor(USER_A, 'token-a');
    const del = await app.inject({
      method: 'DELETE',
      url: `/notifications/devices/${deviceId}`,
      headers: as(USER_B),
    });
    expect(del.statusCode).toBe(404);
    const list = await app.inject({
      method: 'GET',
      url: '/notifications/devices',
      headers: as(USER_A),
    });
    expect((list.json() as { data: Array<{ id: string }> }).data.map((d) => d.id)).toEqual([
      deviceId,
    ]);
    const own = await app.inject({
      method: 'DELETE',
      url: `/notifications/devices/${deviceId}`,
      headers: as(USER_A),
    });
    expect(own.statusCode).toBe(204);
  });
  it('rejects malformed device bodies with 400', async () => {
    for (const payload of [
      { platform: 'symbian', pushToken: 't' },
      { platform: 'web', pushToken: 12345 },
      { platform: 'web', pushToken: 't', userId: USER_B },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: '/notifications/devices',
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
  it('rejects malformed preference patches with 400 and leaves preferences unchanged', async () => {
    for (const payload of [
      { digestFrequency: 'hourly' },
      { quietHours: { enabled: true, startTime: '25:99', endTime: '06:00', days: [1] } },
      { quietHours: { enabled: true, startTime: '21:00', endTime: '06:00', days: [9] } },
      { categories: 'all' },
      { categories: [{ category: 'academic', channels: { email: 'yes' } }] },
      { digestFrequency: 'daily', tenantId: 'other' },
    ]) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/notifications/preferences',
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const prefs = await app.inject({ method: 'GET', url: '/notifications/preferences' });
    expect((prefs.json() as { digestFrequency: string }).digestFrequency).toBe('immediate');
  });
  it('accepts the web/e2e preference and device shapes', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/notifications/preferences',
      payload: {
        digestFrequency: 'weekly',
        quietHours: { enabled: true, startTime: '21:00', endTime: '06:00', days: [1, 2, 3] },
        categories: [
          {
            category: 'academic',
            channels: { email: true, in_app: true, push: false, webhook: false, sms: false },
          },
        ],
      },
    });
    expect(patch.statusCode).toBe(200);
    expect((patch.json() as { digestFrequency: string }).digestFrequency).toBe('weekly');
    await registerFor(USER_A, 'web-token');
  });
  it('the Postgres store deletes only the caller-owned device row', async () => {
    const calls: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      query: async (text: string, values?: unknown[]) => {
        calls.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
    };
    const store = createPgNotificationPrefsStore(pool);
    await store.deleteDevice(TENANT, USER_B, 'dev-1');
    const del = calls.find((c) => c.text.includes('DELETE FROM notification_devices'));
    expect(del?.text).toMatch(/user_id\s*=\s*\$\d/);
    expect(del?.values).toContain(USER_B);
  });
});
