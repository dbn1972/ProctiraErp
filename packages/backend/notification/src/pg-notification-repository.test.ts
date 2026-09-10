/**
 * Live DATABASE_URL smoke: notification delivery survives re-read (G-207).
 * Provider path remains sandbox / WAIVED.
 */
import { randomUUID } from 'node:crypto';

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
});
