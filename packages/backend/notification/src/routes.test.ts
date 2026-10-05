/**
 * Route integration tests for Notification Service
 *
 * Tests HTTP endpoints via Fastify inject:
 * - POST /notifications/send
 * - GET /notifications/:notificationId
 * - POST /notifications/:notificationId/read
 * - GET /notifications/user/:userId
 * - POST /notifications/rules
 * - GET /notifications/rules
 * - POST /notifications/templates
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import { NotificationService } from './notification-service.js';
import { registerNotificationRoutes } from './routes.js';

describe('Notification Routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryNotificationRepository;
  let service: NotificationService;

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const templateId = '22222222-2222-4222-8222-222222222222';
  const userId1 = '33333333-3333-4333-8333-333333333333';
  const roleId1 = '55555555-5555-4555-8555-555555555555';

  beforeEach(async () => {
    repository = new InMemoryNotificationRepository();
    service = new NotificationService(repository);

    // Seed test users
    repository.seedUsers([{ id: userId1, roleIds: [roleId1], areaIds: [], institutionIds: [] }]);

    // Create a template
    await repository.createTemplate({
      id: templateId,
      tenantId,
      name: 'Test Template',
      channel: 'in_app',
      subject: null,
      body: 'Hello {{name}}, you have a notification.',
      variables: ['name'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    app = Fastify();

    // Add tenantId decorator
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId: string }).tenantId = tenantId;
      // W1-SEC-02 package guards — staff principal for send/rules/templates.
      (
        request as typeof request & {
          user?: { sub: string; roles: string[] };
        }
      ).user = { sub: userId1, roles: ['notification_admin'] };
    });

    await registerNotificationRoutes(app, {
      notificationService: service,
      prefix: '/notifications',
    });

    await app.ready();
  });

  // ─── POST /notifications/send ────────────────────────────────────────────

  describe('POST /notifications/send', () => {
    it('should send a notification and return 201', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/send',
        payload: {
          channel: 'in_app',
          templateId,
          recipients: { userIds: [userId1] },
          variables: { name: 'John' },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].recipientUserId).toBe(userId1);
      expect(body.data[0].channel).toBe('in_app');
      expect(body.data[0].status).toBe('delivered');
      expect(body.summary.totalSent).toBe(1);
    });

    it('should return 400 for invalid payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/send',
        payload: {
          channel: 'invalid_channel',
          templateId: 'not-a-uuid',
          recipients: {},
          variables: {},
        },
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.payload);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('should return 404 for non-existent template', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/send',
        payload: {
          channel: 'in_app',
          templateId: '99999999-9999-4999-8999-999999999999',
          recipients: { userIds: [userId1] },
          variables: {},
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── GET /notifications/:notificationId ──────────────────────────────────

  describe('GET /notifications/:notificationId', () => {
    it('should return notification delivery status', async () => {
      // First send a notification
      const sendResponse = await app.inject({
        method: 'POST',
        url: '/notifications/send',
        payload: {
          channel: 'in_app',
          templateId,
          recipients: { userIds: [userId1] },
          variables: { name: 'Test' },
        },
      });

      const sendBody = JSON.parse(sendResponse.payload);
      const notificationId = sendBody.data[0].id;

      // Get delivery status
      const response = await app.inject({
        method: 'GET',
        url: `/notifications/${notificationId}`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.id).toBe(notificationId);
      expect(body.status).toBe('delivered');
    });

    it('should return 404 for non-existent notification', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/notifications/99999999-9999-4999-8999-999999999999',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  // ─── POST /notifications/:notificationId/read ────────────────────────────

  describe('POST /notifications/:notificationId/read', () => {
    it('should mark notification as read', async () => {
      // Send a notification
      const sendResponse = await app.inject({
        method: 'POST',
        url: '/notifications/send',
        payload: {
          channel: 'in_app',
          templateId,
          recipients: { userIds: [userId1] },
          variables: { name: 'Test' },
        },
      });

      const sendBody = JSON.parse(sendResponse.payload);
      const notificationId = sendBody.data[0].id;

      // Mark as read
      const response = await app.inject({
        method: 'POST',
        url: `/notifications/${notificationId}/read`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.status).toBe('read');
      expect(body.readAt).not.toBeNull();
    });
  });

  // ─── GET /notifications/user/:userId ─────────────────────────────────────

  describe('GET /notifications/user/:userId', () => {
    it('should return paginated user notifications', async () => {
      // Send multiple notifications
      for (let i = 0; i < 3; i++) {
        await app.inject({
          method: 'POST',
          url: '/notifications/send',
          payload: {
            channel: 'in_app',
            templateId,
            recipients: { userIds: [userId1] },
            variables: { name: `User${i}` },
          },
        });
      }

      const response = await app.inject({
        method: 'GET',
        url: `/notifications/user/${userId1}?page=1&pageSize=2`,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(3);
      expect(body.pagination.totalPages).toBe(2);
    });
    it('filters to unread notifications (PRC-M114)', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 2; i++) {
        const sent = await app.inject({
          method: 'POST',
          url: '/notifications/send',
          payload: {
            channel: 'in_app',
            templateId,
            recipients: { userIds: [userId1] },
            variables: { name: `U${i}` },
          },
        });
        ids.push(JSON.parse(sent.payload).data[0].id);
      }
      await app.inject({ method: 'POST', url: `/notifications/${ids[0]}/read` });
      const response = await app.inject({
        method: 'GET',
        url: `/notifications/user/${userId1}?unread=true&page=1&pageSize=10`,
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data.map((n: { id: string }) => n.id)).toEqual([ids[1]]);
      expect(body.pagination.total).toBe(1);
    });
  });

  // ─── POST /notifications/rules ───────────────────────────────────────────

  describe('POST /notifications/rules', () => {
    it('should create a notification rule', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/rules',
        payload: {
          name: 'Student Enrollment Alert',
          entityType: 'student',
          event: 'create',
          conditions: { status: 'enrolled' },
          templateId,
          channels: ['in_app'],
          recipientQuery: { roleIds: [roleId1] },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.name).toBe('Student Enrollment Alert');
      expect(body.entityType).toBe('student');
      expect(body.event).toBe('create');
      expect(body.isActive).toBe(true);
    });

    it('should return 400 for invalid rule payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/rules',
        payload: {
          name: '',
          entityType: '',
          event: 'invalid',
          conditions: {},
          templateId: 'not-uuid',
          channels: [],
          recipientQuery: {},
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── GET /notifications/rules ────────────────────────────────────────────

  describe('GET /notifications/rules', () => {
    it('should list all rules for the tenant', async () => {
      // Create a rule first
      await app.inject({
        method: 'POST',
        url: '/notifications/rules',
        payload: {
          name: 'Test Rule',
          entityType: 'student',
          event: 'create',
          conditions: {},
          templateId,
          channels: ['in_app'],
          recipientQuery: { roleIds: [roleId1] },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/notifications/rules',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe('Test Rule');
    });
  });

  // ─── POST /notifications/templates ───────────────────────────────────────

  describe('POST /notifications/templates', () => {
    it('should create a notification template', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/templates',
        payload: {
          name: 'Welcome Email',
          channel: 'email',
          subject: 'Welcome {{name}}',
          body: 'Dear {{name}}, welcome to {{school}}!',
          variables: ['name', 'school'],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.name).toBe('Welcome Email');
      expect(body.channel).toBe('email');
      expect(body.variables).toEqual(['name', 'school']);
    });

    it('should return 400 for invalid template payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/notifications/templates',
        payload: {
          name: '',
          channel: 'invalid',
          body: '',
          variables: [],
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ─── DELETE /notifications/rules/:ruleId ─────────────────────────────────

  describe('DELETE /notifications/rules/:ruleId', () => {
    it('should delete a notification rule', async () => {
      // Create a rule
      const createResponse = await app.inject({
        method: 'POST',
        url: '/notifications/rules',
        payload: {
          name: 'To Delete',
          entityType: 'student',
          event: 'delete',
          conditions: {},
          templateId,
          channels: ['in_app'],
          recipientQuery: { userIds: [userId1] },
        },
      });

      const ruleId = JSON.parse(createResponse.payload).id;

      // Delete it
      const response = await app.inject({
        method: 'DELETE',
        url: `/notifications/rules/${ruleId}`,
      });

      expect(response.statusCode).toBe(204);

      // Verify it's gone
      const getResponse = await app.inject({
        method: 'GET',
        url: `/notifications/rules/${ruleId}`,
      });

      expect(getResponse.statusCode).toBe(404);
    });
  });
});

// ─── PRC-H070: notification read IDOR ──────────────────────────────────────

describe('PRC-H070 notification read authorization', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const templateId = '22222222-2222-4222-8222-222222222222';
  const userA = '33333333-3333-4333-8333-333333333333';
  const userB = '44444444-4444-4444-8444-444444444444';

  let repository: InMemoryNotificationRepository;
  let service: NotificationService;
  // Mutable principal so each test can act as a specific user/role.
  let principal: { sub: string; roles: string[] };

  async function build(): Promise<FastifyInstance> {
    const app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId: string }).tenantId = tenantId;
      (request as typeof request & { user?: { sub: string; roles: string[] } }).user = principal;
    });
    await registerNotificationRoutes(app, {
      notificationService: service,
      prefix: '/notifications',
    });
    await app.ready();
    return app;
  }

  beforeEach(async () => {
    repository = new InMemoryNotificationRepository();
    service = new NotificationService(repository);
    repository.seedUsers([
      { id: userA, roleIds: [], areaIds: [], institutionIds: [] },
      { id: userB, roleIds: [], areaIds: [], institutionIds: [] },
    ]);
    await repository.createTemplate({
      id: templateId,
      tenantId,
      name: 'T',
      channel: 'in_app',
      subject: null,
      body: 'Hi {{name}}',
      variables: ['name'],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  async function sendToUserAAsStaff(app: FastifyInstance): Promise<string> {
    principal = { sub: 'staff-1', roles: ['notification_admin'] };
    const send = await app.inject({
      method: 'POST',
      url: '/notifications/send',
      payload: {
        channel: 'in_app',
        templateId,
        recipients: { userIds: [userA] },
        variables: { name: 'A' },
      },
    });
    expect(send.statusCode).toBe(201);
    return JSON.parse(send.payload).data[0].id as string;
  }

  it('denies user B reading user A notifications list, own list allowed', async () => {
    const app = await build();
    await sendToUserAAsStaff(app);

    principal = { sub: userB, roles: [] };
    const other = await app.inject({ method: 'GET', url: `/notifications/user/${userA}` });
    expect(other.statusCode).toBe(403);

    const own = await app.inject({ method: 'GET', url: `/notifications/user/${userB}` });
    expect(own.statusCode).toBe(200);
    await app.close();
  });

  it('denies user B reading and marking-read user A notification by id (404)', async () => {
    const app = await build();
    const id = await sendToUserAAsStaff(app);

    principal = { sub: userB, roles: [] };
    const get = await app.inject({ method: 'GET', url: `/notifications/${id}` });
    expect(get.statusCode).toBe(404);
    const read = await app.inject({ method: 'POST', url: `/notifications/${id}/read` });
    expect(read.statusCode).toBe(404);
    await app.close();
  });

  it('the recipient can read and mark-read their own notification', async () => {
    const app = await build();
    const id = await sendToUserAAsStaff(app);

    principal = { sub: userA, roles: [] };
    const get = await app.inject({ method: 'GET', url: `/notifications/${id}` });
    expect(get.statusCode).toBe(200);
    const read = await app.inject({ method: 'POST', url: `/notifications/${id}/read` });
    expect(read.statusCode).toBe(200);
    await app.close();
  });

  it('staff can read any user notification', async () => {
    const app = await build();
    const id = await sendToUserAAsStaff(app);

    principal = { sub: 'staff-2', roles: ['notification_admin'] };
    const get = await app.inject({ method: 'GET', url: `/notifications/${id}` });
    expect(get.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: `/notifications/user/${userA}` });
    expect(list.statusCode).toBe(200);
    await app.close();
  });

  it('cross-tenant notification id returns 404 even for staff', async () => {
    // The onRequest hook pins the request tenant to `tenantId`; a notification created for a
    // DIFFERENT tenant must not be readable here (repository filters by tenant_id).
    const app = await build();
    const OTHER_TENANT = '99999999-9999-4999-8999-999999999999';
    await repository.createTemplate({
      id: '88888888-8888-4888-8888-888888888888',
      tenantId: OTHER_TENANT,
      name: 'X',
      channel: 'in_app',
      subject: null,
      body: 'x',
      variables: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const foreign = await service.send(OTHER_TENANT, {
      channel: 'in_app',
      templateId: '88888888-8888-4888-8888-888888888888',
      recipients: { userIds: [userA] },
      variables: {},
    });
    const foreignId = foreign[0]!.id;

    principal = { sub: 'staff-2', roles: ['notification_admin'] };
    const get = await app.inject({ method: 'GET', url: `/notifications/${foreignId}` });
    expect(get.statusCode).toBe(404);
    await app.close();
  });
});
