/**
 * Direct unit tests for `InMemoryNotificationRepository.countUnreadNotifications`,
 * exercised in isolation — no `NotificationService`, HTTP route, or cache
 * wrapper involved.
 *
 * This complements two other test suites that already cover this method,
 * but only indirectly:
 * - `routes.test.ts`'s `GET /notifications/user/:userId/unread-count` describe
 *   block asserts the HTTP contract (some-unread → `{ count: 2 }`, zero-unread
 *   → `{ count: 0 }`, missing-tenant → 400) through the full route + service
 *   stack.
 * - `notification-service.test.ts`'s `countUnreadNotifications` describe block
 *   covers the optional Redis read-through cache wrapper *around* this
 *   method, not the method's own filtering logic.
 *
 * (principal-dashboard-parity spec, Task 3.4 — Requirements 2.5, 2.6, 2.7)
 */
import { describe, expect, it } from 'vitest';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import type { NotificationEntity } from './notification-repository.js';
import type { DeliveryStatus } from './schemas.js';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const userA = '33333333-3333-4333-8333-333333333333';
const userB = '44444444-4444-4444-8444-444444444444';

let sequence = 0;

/** Builds a minimal, valid `NotificationEntity` fixture for a given tenant/user/status. */
function buildNotification(fields: {
  tenantId: string;
  recipientUserId: string;
  status: DeliveryStatus;
}): NotificationEntity {
  sequence += 1;
  return {
    id: `notification-${sequence}`,
    tenantId: fields.tenantId,
    channel: 'in_app',
    templateId: 'template-1',
    recipientUserId: fields.recipientUserId,
    variables: {},
    status: fields.status,
    priority: 'normal',
    retryCount: 0,
    maxRetries: 0,
    sentAt: new Date(),
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    failureReason: null,
    webhookUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('InMemoryNotificationRepository', () => {
  describe('countUnreadNotifications', () => {
    it('returns 0 for a user whose notifications are only read or failed', async () => {
      const repository = new InMemoryNotificationRepository();
      await repository.createNotification(
        buildNotification({ tenantId: tenantA, recipientUserId: userA, status: 'read' }),
      );
      await repository.createNotification(
        buildNotification({ tenantId: tenantA, recipientUserId: userA, status: 'failed' }),
      );

      const count = await repository.countUnreadNotifications(tenantA, userA);

      expect(count).toBe(0);
    });

    it('counts only the sent/delivered notifications out of a mixed-status set', async () => {
      const repository = new InMemoryNotificationRepository();
      const statuses: DeliveryStatus[] = ['sent', 'delivered', 'read', 'failed'];
      for (const status of statuses) {
        await repository.createNotification(
          buildNotification({ tenantId: tenantA, recipientUserId: userA, status }),
        );
      }

      const count = await repository.countUnreadNotifications(tenantA, userA);

      // Only the 'sent' and 'delivered' rows are unread; 'read' and 'failed' are excluded.
      expect(count).toBe(2);
    });

    it('excludes notifications belonging to a different tenant for the same user (tenant isolation)', async () => {
      const repository = new InMemoryNotificationRepository();
      await repository.createNotification(
        buildNotification({ tenantId: tenantA, recipientUserId: userA, status: 'sent' }),
      );
      // Same userId, but under a different tenant — must never be counted for tenantA.
      await repository.createNotification(
        buildNotification({ tenantId: tenantB, recipientUserId: userA, status: 'sent' }),
      );
      await repository.createNotification(
        buildNotification({ tenantId: tenantB, recipientUserId: userA, status: 'delivered' }),
      );

      const count = await repository.countUnreadNotifications(tenantA, userA);

      expect(count).toBe(1);
    });

    it('excludes notifications belonging to a different user in the same tenant (user isolation)', async () => {
      const repository = new InMemoryNotificationRepository();
      await repository.createNotification(
        buildNotification({ tenantId: tenantA, recipientUserId: userA, status: 'sent' }),
      );
      // Different user, same tenant — must never be counted for userA.
      await repository.createNotification(
        buildNotification({ tenantId: tenantA, recipientUserId: userB, status: 'sent' }),
      );
      await repository.createNotification(
        buildNotification({ tenantId: tenantA, recipientUserId: userB, status: 'delivered' }),
      );

      const count = await repository.countUnreadNotifications(tenantA, userA);

      expect(count).toBe(1);
    });
  });
});
