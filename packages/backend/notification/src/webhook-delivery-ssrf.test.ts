/**
 * g7_platform-002 — notification webhook channel: SSRF guard + real sender + 2xx-only delivery.
 *
 * These tests FAIL without the fix: before, the webhook branch marked a notification 'delivered'
 * whenever no sender was configured (false confirmation), and performed no SSRF validation on the
 * tenant-supplied webhookUrl.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import { NotificationService, type WebhookSender } from './notification-service.js';
import { createSafeFetchWebhookSender } from './webhook-sender.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const templateId = '22222222-2222-4222-8222-222222222222';
const notificationId = '33333333-3333-4333-8333-333333333333';
const userId1 = '44444444-4444-4444-8444-444444444444';

async function seedWebhookNotification(
  repository: InMemoryNotificationRepository,
  webhookUrl: string | null,
) {
  await repository.createTemplate({
    id: templateId,
    tenantId,
    name: 'Hook',
    channel: 'webhook',
    subject: 'Hook {{name}}',
    body: 'Hello {{name}}',
    variables: ['name'],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await repository.createNotification({
    id: notificationId,
    tenantId,
    channel: 'webhook',
    templateId,
    recipientUserId: userId1,
    variables: { name: 'Test' },
    status: 'pending',
    priority: 'normal',
    retryCount: 0,
    maxRetries: 3,
    sentAt: new Date(),
    deliveredAt: null,
    readAt: null,
    failedAt: null,
    failureReason: null,
    webhookUrl,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe('g7_platform-002 notification webhook delivery', () => {
  let repository: InMemoryNotificationRepository;
  beforeEach(() => {
    repository = new InMemoryNotificationRepository();
  });

  it('does NOT mark delivered when no webhook sender is configured', async () => {
    const service = new NotificationService(repository); // no webhookSender
    await seedWebhookNotification(repository, 'https://example.com/hook');
    const n = await repository.getNotificationById(tenantId, notificationId);
    const t = await repository.getTemplateById(tenantId, templateId);
    await service.attemptDelivery(n!, t!);
    const updated = await repository.getNotificationById(tenantId, notificationId);
    expect(updated!.status).not.toBe('delivered');
  });

  it('does NOT mark delivered when the webhook URL is SSRF-unsafe (metadata IP)', async () => {
    const sender: WebhookSender = {
      async send() {
        return { success: true, statusCode: 200 };
      },
    };
    const service = new NotificationService(repository, undefined, undefined, sender);
    await seedWebhookNotification(repository, 'https://169.254.169.254/latest/meta-data/');
    const n = await repository.getNotificationById(tenantId, notificationId);
    const t = await repository.getTemplateById(tenantId, templateId);
    await service.attemptDelivery(n!, t!);
    const updated = await repository.getNotificationById(tenantId, notificationId);
    expect(updated!.status).not.toBe('delivered');
  });
});

describe('g7_platform-002 SafeFetchWebhookSender', () => {
  const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }];

  it('reports success only on 2xx', async () => {
    const sender = createSafeFetchWebhookSender({
      fetchImpl: ((_url: string, _opts: unknown) =>
        Promise.resolve(new Response('{}', { status: 200 }))) as never,
    });
    const ok = await sender.send({ url: 'https://x', payload: {}, tenantId });
    expect(ok.success).toBe(true);

    const sender500 = createSafeFetchWebhookSender({
      fetchImpl: ((_url: string, _opts: unknown) =>
        Promise.resolve(new Response('err', { status: 500 }))) as never,
    });
    const bad = await sender500.send({ url: 'https://x', payload: {}, tenantId });
    expect(bad.success).toBe(false);
  });

  it('reports failure when the real safeFetch rejects a metadata IP', async () => {
    // Default fetchImpl = shared safeFetch; literal metadata IP is rejected without DNS.
    const sender = createSafeFetchWebhookSender();
    const res = await sender.send({
      url: 'https://169.254.169.254/latest/meta-data/',
      payload: {},
      tenantId,
    });
    expect(res.success).toBe(false);
    void publicResolver;
  });
});
