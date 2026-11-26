/**
 * PRC-M308: a notification is 'delivered' only when a real provider accepted it.
 * Sandbox senders and a missing sender accept the message without sending it, so
 * the row stays 'sent' with no deliveredAt. Live senders and in-app records are
 * still 'delivered'.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import {
  NotificationService,
  type EmailSender,
  type PushSender,
  type SmsSender,
} from './notification-service.js';
import { createSandboxEmailSender } from './sandbox-email-sender.js';
import { createSandboxPushSender } from './sandbox-push-sender.js';
import { createSandboxSmsSender } from './sandbox-sms-sender.js';

const TENANT = '6f0b6c1e-3b7a-4c55-9d1e-2a4f8b9c0d11';
const USER = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
type Channel = 'email' | 'push' | 'sms' | 'in_app';

const live = { success: true, messageId: 'provider-1', mode: 'live' as const };

async function sendOne(
  channel: Channel,
  senders: { emailSender?: EmailSender; pushSender?: PushSender; smsSender?: SmsSender },
) {
  const repository = new InMemoryNotificationRepository();
  const service = new NotificationService(
    repository,
    senders.emailSender,
    senders.pushSender,
    undefined,
    senders.smsSender,
  );
  const template = await service.createTemplate(TENANT, {
    name: `t-${channel}`,
    channel,
    subject: 'Hello',
    body: 'Hi {{name}}',
    variables: ['name'],
  });
  const [notification] = await service.send(TENANT, {
    channel,
    templateId: template.id,
    recipients: { userIds: [USER] },
    variables: { name: 'Asha' },
  });
  return notification!;
}

describe('delivery status honesty (PRC-M308)', () => {
  for (const channel of ['email', 'push', 'sms'] as const) {
    it(`${channel}: a sandbox send stays 'sent' with no deliveredAt`, async () => {
      const n = await sendOne(channel, {
        emailSender: createSandboxEmailSender(),
        pushSender: createSandboxPushSender(),
        smsSender: createSandboxSmsSender(),
      });
      expect(n.status).toBe('sent');
      expect(n.deliveredAt).toBeNull();
    });

    it(`${channel}: no configured sender stays 'sent' with no deliveredAt`, async () => {
      const n = await sendOne(channel, {});
      expect(n.status).toBe('sent');
      expect(n.deliveredAt).toBeNull();
    });

    it(`${channel}: a live provider acceptance is 'delivered'`, async () => {
      const n = await sendOne(channel, {
        emailSender: { send: async () => live },
        pushSender: { send: async () => live },
        smsSender: { send: async () => live },
      });
      expect(n.status).toBe('delivered');
      expect(n.deliveredAt).toBeInstanceOf(Date);
    });
  }

  it("in_app: creating the record is the delivery ('delivered')", async () => {
    const n = await sendOne('in_app', {});
    expect(n.status).toBe('delivered');
  });
});
