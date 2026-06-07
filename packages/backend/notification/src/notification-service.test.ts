/**
 * Unit tests for NotificationService
 *
 * Tests core business logic:
 * - Template rendering with variable substitution (Req 22.4)
 * - Multi-channel notification sending (Req 22.1)
 * - Delivery status tracking (Req 22.5)
 * - Retry with exponential backoff (Req 22.6)
 * - Rule-based triggering (Req 22.2)
 * - Recipient resolution (Req 22.3)
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import { NotificationService, type EmailSender, type NotificationQueuePublisher } from './notification-service.js';
import type { NotificationEntity } from './notification-repository.js';

describe('NotificationService', () => {
  let repository: InMemoryNotificationRepository;
  let service: NotificationService;

  const tenantId = '11111111-1111-4111-8111-111111111111';
  const templateId = '22222222-2222-4222-8222-222222222222';
  const userId1 = '33333333-3333-4333-8333-333333333333';
  const userId2 = '44444444-4444-4444-8444-444444444444';
  const roleId1 = '55555555-5555-4555-8555-555555555555';
  const areaId1 = '66666666-6666-4666-8666-666666666666';

  beforeEach(() => {
    repository = new InMemoryNotificationRepository();
    service = new NotificationService(repository);

    // Seed test users
    repository.seedUsers([
      { id: userId1, roleIds: [roleId1], areaIds: [areaId1], institutionIds: [] },
      { id: userId2, roleIds: [roleId1], areaIds: [areaId1], institutionIds: [] },
    ]);
  });

  // ─── Template Rendering ──────────────────────────────────────────────────

  describe('renderTemplate', () => {
    it('should substitute variables in template', () => {
      const template = 'Hello {{name}}, your enrollment at {{school}} is confirmed.';
      const variables = { name: 'John', school: 'Springfield Elementary' };

      const result = service.renderTemplate(template, variables);

      expect(result).toBe('Hello John, your enrollment at Springfield Elementary is confirmed.');
    });

    it('should leave unmatched placeholders unchanged', () => {
      const template = 'Hello {{name}}, your {{status}} is pending.';
      const variables = { name: 'Jane' };

      const result = service.renderTemplate(template, variables);

      expect(result).toBe('Hello Jane, your {{status}} is pending.');
    });

    it('should handle template with no variables', () => {
      const template = 'This is a static notification.';
      const variables = {};

      const result = service.renderTemplate(template, variables);

      expect(result).toBe('This is a static notification.');
    });

    it('should handle multiple occurrences of the same variable', () => {
      const template = '{{name}} has been enrolled. Welcome, {{name}}!';
      const variables = { name: 'Alice' };

      const result = service.renderTemplate(template, variables);

      expect(result).toBe('Alice has been enrolled. Welcome, Alice!');
    });
  });

  // ─── Exponential Backoff ─────────────────────────────────────────────────

  describe('calculateBackoffDelay', () => {
    it('should calculate correct delay for retry 1', () => {
      const delay = service.calculateBackoffDelay(1);
      expect(delay).toBe(1000); // 1000 * 2^0 = 1000ms
    });

    it('should calculate correct delay for retry 2', () => {
      const delay = service.calculateBackoffDelay(2);
      expect(delay).toBe(2000); // 1000 * 2^1 = 2000ms
    });

    it('should calculate correct delay for retry 3', () => {
      const delay = service.calculateBackoffDelay(3);
      expect(delay).toBe(4000); // 1000 * 2^2 = 4000ms
    });
  });

  // ─── Send Notification ───────────────────────────────────────────────────

  describe('send', () => {
    beforeEach(async () => {
      // Create a template
      await repository.createTemplate({
        id: templateId,
        tenantId,
        name: 'Welcome Email',
        channel: 'email',
        subject: 'Welcome {{name}}',
        body: 'Hello {{name}}, welcome to {{school}}!',
        variables: ['name', 'school'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should send notification to explicit user IDs', async () => {
      const notifications = await service.send(tenantId, {
        channel: 'email',
        templateId,
        recipients: { userIds: [userId1] },
        variables: { name: 'John', school: 'Test School' },
      });

      expect(notifications).toHaveLength(1);
      expect(notifications[0]!.recipientUserId).toBe(userId1);
      expect(notifications[0]!.channel).toBe('email');
      expect(notifications[0]!.status).toBe('delivered');
    });

    it('should send notification to all users matching role criteria', async () => {
      const notifications = await service.send(tenantId, {
        channel: 'email',
        templateId,
        recipients: { roleIds: [roleId1] },
        variables: { name: 'Team', school: 'Test School' },
      });

      expect(notifications).toHaveLength(2);
      const recipientIds = notifications.map(n => n.recipientUserId);
      expect(recipientIds).toContain(userId1);
      expect(recipientIds).toContain(userId2);
    });

    it('should throw NotFoundError for non-existent template', async () => {
      const fakeTemplateId = '99999999-9999-4999-8999-999999999999';

      await expect(
        service.send(tenantId, {
          channel: 'email',
          templateId: fakeTemplateId,
          recipients: { userIds: [userId1] },
          variables: {},
        }),
      ).rejects.toThrow('not found');
    });

    it('should throw ValidationError when channel does not match template', async () => {
      await expect(
        service.send(tenantId, {
          channel: 'push',
          templateId,
          recipients: { userIds: [userId1] },
          variables: {},
        }),
      ).rejects.toThrow('does not match');
    });

    it('should throw BusinessRuleError when no recipients found', async () => {
      await expect(
        service.send(tenantId, {
          channel: 'email',
          templateId,
          recipients: { userIds: [] },
          variables: {},
        }),
      ).rejects.toThrow('No recipients found');
    });

    it('should set priority to normal by default', async () => {
      const notifications = await service.send(tenantId, {
        channel: 'email',
        templateId,
        recipients: { userIds: [userId1] },
        variables: { name: 'Test', school: 'School' },
      });

      expect(notifications[0]!.priority).toBe('normal');
    });

    it('should respect custom priority', async () => {
      const notifications = await service.send(tenantId, {
        channel: 'email',
        templateId,
        recipients: { userIds: [userId1] },
        variables: { name: 'Test', school: 'School' },
        priority: 'high',
      });

      expect(notifications[0]!.priority).toBe('high');
    });

    it('should set maxRetries to 3 for email channel', async () => {
      const notifications = await service.send(tenantId, {
        channel: 'email',
        templateId,
        recipients: { userIds: [userId1] },
        variables: { name: 'Test', school: 'School' },
      });

      expect(notifications[0]!.maxRetries).toBe(3);
    });

    it('should set maxRetries to 0 for in_app channel', async () => {
      // Create in-app template
      const inAppTemplateId = '77777777-7777-4777-8777-777777777777';
      await repository.createTemplate({
        id: inAppTemplateId,
        tenantId,
        name: 'In-App Notification',
        channel: 'in_app',
        subject: null,
        body: 'You have a new message from {{sender}}.',
        variables: ['sender'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const notifications = await service.send(tenantId, {
        channel: 'in_app',
        templateId: inAppTemplateId,
        recipients: { userIds: [userId1] },
        variables: { sender: 'Admin' },
      });

      expect(notifications[0]!.maxRetries).toBe(0);
    });
  });

  // ─── Delivery with Email Sender ──────────────────────────────────────────

  describe('delivery with email sender', () => {
    let emailSender: EmailSender;
    let queuedNotifications: Array<{ notification: NotificationEntity; delayMs: number }>;

    beforeEach(async () => {
      queuedNotifications = [];

      const queuePublisher: NotificationQueuePublisher = {
        async queueForDelivery(notification, delayMs) {
          queuedNotifications.push({ notification, delayMs });
        },
      };

      emailSender = {
        async send() {
          return { success: false, error: 'SMTP connection failed' };
        },
      };

      service = new NotificationService(
        repository,
        emailSender,
        undefined,
        undefined,
        queuePublisher,
      );

      await repository.createTemplate({
        id: templateId,
        tenantId,
        name: 'Test Email',
        channel: 'email',
        subject: 'Test Subject',
        body: 'Test body for {{name}}',
        variables: ['name'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should queue for retry on email delivery failure', async () => {
      const notifications = await service.send(tenantId, {
        channel: 'email',
        templateId,
        recipients: { userIds: [userId1] },
        variables: { name: 'Test' },
      });

      // Notification should be marked as failed (delivery failed)
      expect(notifications[0]!.status).toBe('failed');
      
      // Should have queued for retry
      expect(queuedNotifications).toHaveLength(1);
      expect(queuedNotifications[0]!.delayMs).toBe(1000); // First retry: 1000ms
    });

    it('should mark as permanently failed when max retries exhausted', async () => {
      // Create a notification that has already been retried max times
      const notificationId = '88888888-8888-4888-8888-888888888888';
      await repository.createNotification({
        id: notificationId,
        tenantId,
        channel: 'email',
        templateId,
        recipientUserId: userId1,
        variables: { name: 'Test' },
        status: 'failed',
        priority: 'normal',
        retryCount: 2, // Already retried twice
        maxRetries: 3,
        sentAt: new Date(),
        deliveredAt: null,
        readAt: null,
        failedAt: new Date(),
        failureReason: 'Previous failure',
        webhookUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const template = await repository.getTemplateById(tenantId, templateId);
      const notification = await repository.getNotificationById(tenantId, notificationId);

      await service.attemptDelivery(notification!, template!);

      // Should be permanently failed
      const updated = await repository.getNotificationById(tenantId, notificationId);
      expect(updated!.status).toBe('failed');
      expect(updated!.retryCount).toBe(3);
      expect(updated!.failureReason).toContain('max retries exhausted');
    });
  });

  // ─── Mark as Read ────────────────────────────────────────────────────────

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const inAppTemplateId = '77777777-7777-4777-8777-777777777777';
      await repository.createTemplate({
        id: inAppTemplateId,
        tenantId,
        name: 'In-App',
        channel: 'in_app',
        subject: null,
        body: 'Test notification',
        variables: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const notifications = await service.send(tenantId, {
        channel: 'in_app',
        templateId: inAppTemplateId,
        recipients: { userIds: [userId1] },
        variables: {},
      });

      const notificationId = notifications[0]!.id;
      const updated = await service.markAsRead(tenantId, notificationId);

      expect(updated.status).toBe('read');
      expect(updated.readAt).not.toBeNull();
    });

    it('should throw NotFoundError for non-existent notification', async () => {
      const fakeId = '99999999-9999-4999-8999-999999999999';
      await expect(service.markAsRead(tenantId, fakeId)).rejects.toThrow('not found');
    });
  });

  // ─── Rule Management ─────────────────────────────────────────────────────

  describe('createRule', () => {
    beforeEach(async () => {
      await repository.createTemplate({
        id: templateId,
        tenantId,
        name: 'Alert Template',
        channel: 'email',
        subject: 'Alert: {{event}}',
        body: '{{message}}',
        variables: ['event', 'message'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should create a notification rule', async () => {
      const rule = await service.createRule(tenantId, {
        name: 'Absence Alert',
        entityType: 'attendance',
        event: 'threshold',
        conditions: { absenceCount: { $gt: 5 } },
        templateId,
        channels: ['email', 'in_app'],
        recipientQuery: { roleIds: [roleId1] },
      });

      expect(rule.id).toBeDefined();
      expect(rule.name).toBe('Absence Alert');
      expect(rule.entityType).toBe('attendance');
      expect(rule.event).toBe('threshold');
      expect(rule.isActive).toBe(true);
      expect(rule.channels).toEqual(['email', 'in_app']);
    });

    it('should throw NotFoundError for non-existent template', async () => {
      const fakeTemplateId = '99999999-9999-4999-8999-999999999999';

      await expect(
        service.createRule(tenantId, {
          name: 'Test Rule',
          entityType: 'student',
          event: 'create',
          conditions: {},
          templateId: fakeTemplateId,
          channels: ['email'],
          recipientQuery: { userIds: [userId1] },
        }),
      ).rejects.toThrow('not found');
    });
  });

  // ─── Rule-Based Event Processing ────────────────────────────────────────

  describe('processEvent', () => {
    const inAppTemplateId = '77777777-7777-4777-8777-777777777777';

    beforeEach(async () => {
      // Create in-app template for rule processing
      await repository.createTemplate({
        id: inAppTemplateId,
        tenantId,
        name: 'Event Alert',
        channel: 'in_app',
        subject: null,
        body: 'Event: {{entityType}} was {{event}}',
        variables: ['entityType', 'event'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create a rule
      await repository.createRule({
        id: '99999999-9999-4999-8999-999999999999',
        tenantId,
        name: 'Student Created Alert',
        entityType: 'student',
        event: 'create',
        conditions: {},
        templateId: inAppTemplateId,
        channels: ['in_app'],
        recipientQuery: { roleIds: [roleId1] },
        isActive: true,
        schedule: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should trigger notifications for matching rules', async () => {
      const notifications = await service.processEvent(
        tenantId,
        'student',
        'create',
        { entityType: 'student', event: 'created', studentName: 'John' },
      );

      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications[0]!.channel).toBe('in_app');
    });

    it('should not trigger notifications when no rules match', async () => {
      const notifications = await service.processEvent(
        tenantId,
        'institution',
        'delete',
        { entityType: 'institution' },
      );

      expect(notifications).toHaveLength(0);
    });

    it('should not trigger inactive rules', async () => {
      // Deactivate the rule
      await repository.updateRule('99999999-9999-4999-8999-999999999999', tenantId, {
        isActive: false,
      });

      const notifications = await service.processEvent(
        tenantId,
        'student',
        'create',
        { entityType: 'student' },
      );

      expect(notifications).toHaveLength(0);
    });
  });

  // ─── Condition Evaluation ────────────────────────────────────────────────

  describe('evaluateConditions', () => {
    it('should match when all conditions are met (equality)', () => {
      const conditions = { status: 'active', type: 'school' };
      const payload = { status: 'active', type: 'school', name: 'Test' };

      expect(service.evaluateConditions(conditions, payload)).toBe(true);
    });

    it('should not match when a condition is not met', () => {
      const conditions = { status: 'active' };
      const payload = { status: 'inactive' };

      expect(service.evaluateConditions(conditions, payload)).toBe(false);
    });

    it('should support $gt operator', () => {
      const conditions = { absenceCount: { $gt: 5 } };

      expect(service.evaluateConditions(conditions, { absenceCount: 6 })).toBe(true);
      expect(service.evaluateConditions(conditions, { absenceCount: 5 })).toBe(false);
      expect(service.evaluateConditions(conditions, { absenceCount: 4 })).toBe(false);
    });

    it('should support $gte operator', () => {
      const conditions = { score: { $gte: 50 } };

      expect(service.evaluateConditions(conditions, { score: 50 })).toBe(true);
      expect(service.evaluateConditions(conditions, { score: 51 })).toBe(true);
      expect(service.evaluateConditions(conditions, { score: 49 })).toBe(false);
    });

    it('should support $lt operator', () => {
      const conditions = { percentage: { $lt: 75 } };

      expect(service.evaluateConditions(conditions, { percentage: 74 })).toBe(true);
      expect(service.evaluateConditions(conditions, { percentage: 75 })).toBe(false);
    });

    it('should support $in operator', () => {
      const conditions = { status: { $in: ['enrolled', 'transferred'] } };

      expect(service.evaluateConditions(conditions, { status: 'enrolled' })).toBe(true);
      expect(service.evaluateConditions(conditions, { status: 'withdrawn' })).toBe(false);
    });

    it('should support $ne operator', () => {
      const conditions = { status: { $ne: 'deleted' } };

      expect(service.evaluateConditions(conditions, { status: 'active' })).toBe(true);
      expect(service.evaluateConditions(conditions, { status: 'deleted' })).toBe(false);
    });

    it('should match empty conditions against any payload', () => {
      expect(service.evaluateConditions({}, { anything: 'value' })).toBe(true);
    });
  });

  // ─── User Notifications ──────────────────────────────────────────────────

  describe('getUserNotifications', () => {
    beforeEach(async () => {
      const inAppTemplateId = '77777777-7777-4777-8777-777777777777';
      await repository.createTemplate({
        id: inAppTemplateId,
        tenantId,
        name: 'In-App',
        channel: 'in_app',
        subject: null,
        body: 'Notification {{num}}',
        variables: ['num'],
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create multiple notifications for user
      for (let i = 1; i <= 5; i++) {
        await service.send(tenantId, {
          channel: 'in_app',
          templateId: inAppTemplateId,
          recipients: { userIds: [userId1] },
          variables: { num: String(i) },
        });
      }
    });

    it('should return paginated notifications for a user', async () => {
      const result = await service.getUserNotifications(tenantId, userId1, {
        page: 1,
        pageSize: 3,
      });

      expect(result.data).toHaveLength(3);
      expect(result.total).toBe(5);
      expect(result.totalPages).toBe(2);
    });

    it('should filter by status', async () => {
      // Mark one as read
      const allNotifications = await service.getUserNotifications(tenantId, userId1, {});
      await service.markAsRead(tenantId, allNotifications.data[0]!.id);

      const readOnly = await service.getUserNotifications(tenantId, userId1, {
        status: 'read',
      });

      expect(readOnly.data).toHaveLength(1);
      expect(readOnly.data[0]!.status).toBe('read');
    });
  });

  // ─── Template Management ─────────────────────────────────────────────────

  describe('createTemplate', () => {
    it('should create a notification template', async () => {
      const template = await service.createTemplate(tenantId, {
        name: 'Welcome Email',
        channel: 'email',
        subject: 'Welcome to {{school}}',
        body: 'Dear {{name}}, welcome!',
        variables: ['name', 'school'],
      });

      expect(template.id).toBeDefined();
      expect(template.name).toBe('Welcome Email');
      expect(template.channel).toBe('email');
      expect(template.subject).toBe('Welcome to {{school}}');
      expect(template.body).toBe('Dear {{name}}, welcome!');
      expect(template.variables).toEqual(['name', 'school']);
    });
  });
});
