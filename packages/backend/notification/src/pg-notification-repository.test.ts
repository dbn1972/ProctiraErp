/**
 * Live DATABASE_URL smoke: notification delivery survives re-read (G-207).
 * Provider path remains sandbox / WAIVED.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { describe, expect, it } from 'vitest';

import {
  createPgNotificationRepository,
  isPgNotificationEnabled,
} from './pg-notification-repository.js';
import { createNotificationStack } from './create-notification-stack.js';
import { EMAIL_SANDBOX_HONESTY_NOTE } from './sandbox-email-sender.js';

describe('Pg notification deliveries (G-207)', () => {
  it.skipIf(!isPgNotificationEnabled())(
    'createNotification survives re-read; stack uses postgres; provider waived',
    async () => {
      const stack = createNotificationStack();
      expect(stack.persistence).toBe('postgres');
      expect(EMAIL_SANDBOX_HONESTY_NOTE.length).toBeGreaterThan(0);

      const repo = createPgNotificationRepository();
      expect(repo).not.toBeNull();

      const tenantId = '00000000-0000-4000-8000-0000000000aa';
      const pool = getSharedPgPool();
      expect(pool).not.toBeNull();
      await ensurePgTestTenant(pool!, tenantId);
      const id = randomUUID();
      const templateId = randomUUID();
      const recipientUserId = `user-${randomUUID()}`;

      const created = await repo!.createNotification({
        id,
        tenantId,
        channel: 'email',
        templateId,
        recipientUserId,
        variables: { name: 'Ada' },
        status: 'sent',
        priority: 'normal',
        retryCount: 0,
        maxRetries: 3,
        sentAt: new Date(),
        deliveredAt: null,
        readAt: null,
        failedAt: null,
        failureReason: null,
        webhookUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      expect(created.id).toBe(id);

      const reread = await repo!.getNotificationById(tenantId, id);
      expect(reread).not.toBeNull();
      expect(reread!.recipientUserId).toBe(recipientUserId);
      expect(reread!.channel).toBe('email');
      expect(reread!.status).toBe('sent');
      expect(reread!.variables).toEqual({ name: 'Ada' });
    },
  );

  /**
   * Direct test of `HybridNotificationRepository.countUnreadNotifications`
   * against a real Postgres connection (principal-dashboard-parity spec,
   * Task 3.4 — Requirements 2.5, 2.6). Gated behind the same
   * `isPgNotificationEnabled()` live-DB skip as the sibling test above, so
   * it runs only in environments with a real `DATABASE_URL`.
   */
  it.skipIf(!isPgNotificationEnabled())(
    'countUnreadNotifications counts only sent/delivered rows scoped to tenant and user',
    async () => {
      const repo = createPgNotificationRepository();
      expect(repo).not.toBeNull();

      const tenantId = '00000000-0000-4000-8000-0000000000ab';
      const otherTenantId = '00000000-0000-4000-8000-0000000000ac';
      const pool = getSharedPgPool();
      expect(pool).not.toBeNull();
      await ensurePgTestTenant(pool!, tenantId);
      await ensurePgTestTenant(pool!, otherTenantId);

      const recipientUserId = `user-${randomUUID()}`;
      const otherUserId = `user-${randomUUID()}`;
      const templateId = randomUUID();

      async function createWithStatus(
        forTenantId: string,
        forUserId: string,
        status: 'sent' | 'delivered' | 'read' | 'failed',
      ) {
        await repo!.createNotification({
          id: randomUUID(),
          tenantId: forTenantId,
          channel: 'email',
          templateId,
          recipientUserId: forUserId,
          variables: {},
          status,
          priority: 'normal',
          retryCount: 0,
          maxRetries: 3,
          sentAt: new Date(),
          deliveredAt: status === 'delivered' || status === 'read' ? new Date() : null,
          readAt: status === 'read' ? new Date() : null,
          failedAt: status === 'failed' ? new Date() : null,
          failureReason: status === 'failed' ? 'boom' : null,
          webhookUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Unread for the target tenant/user: sent + delivered.
      await createWithStatus(tenantId, recipientUserId, 'sent');
      await createWithStatus(tenantId, recipientUserId, 'delivered');
      // Not unread: read + failed.
      await createWithStatus(tenantId, recipientUserId, 'read');
      await createWithStatus(tenantId, recipientUserId, 'failed');
      // Same user, different tenant — must not be counted for tenantId.
      await createWithStatus(otherTenantId, recipientUserId, 'sent');
      // Same tenant, different user — must not be counted for recipientUserId.
      await createWithStatus(tenantId, otherUserId, 'sent');

      const count = await repo!.countUnreadNotifications(tenantId, recipientUserId);
      expect(count).toBe(2);
    },
  );
});
