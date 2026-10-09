/**
 * G-922 circulars + ack rate + delivery log + tenant isolate.
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { InMemoryCircularStore } from './circular-store.js';
import { CircularsService } from './circulars-service.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

describe('CircularsService (G-922)', () => {
  it('creates, sends over WhatsApp sandbox, acks, and computes ack rate', async () => {
    const store = new InMemoryCircularStore();
    const service = new CircularsService(store);
    const circular = await service.createCircular(TENANT_A, {
      title: 'Holiday notice',
      body: 'School closed Friday.',
      audienceType: 'all',
      requiresAck: true,
      channels: ['whatsapp', 'in_app'],
      recipientIds: ['staff-1', 'staff-2'],
      recipientLabels: { 'staff-1': 'Ada', 'staff-2': 'Grace' },
    });
    expect(circular.status).toBe('draft');
    expect(circular.ackTotal).toBe(2);
    expect(circular.ackRate).toBe(0);

    const sent = await service.sendCircular(TENANT_A, circular.id);
    expect(sent.status).toBe('sent');

    const logs = (await service.listDeliveryLogs(TENANT_A, { channel: 'whatsapp' })).data;
    expect(logs).toHaveLength(2);
    expect(logs.every((row) => row.status === 'sent')).toBe(true);
    expect(logs[0]!.providerRef).toMatch(/^sandbox-wa:/);

    const afterAck = await service.ackCircular(TENANT_A, circular.id, 'staff-1');
    expect(afterAck.ackCount).toBe(1);
    expect(afterAck.ackRate).toBe(0.5);

    expect((await service.listCirculars(TENANT_B)).data).toHaveLength(0);
    await expect(service.getCircular(TENANT_B, circular.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('bounds the in-process audit fallback log (PRC-L287)', async () => {
    const store = new InMemoryCircularStore();
    const service = new CircularsService(store);
    const total = CircularsService.MAX_LOCAL_AUDIT_ENTRIES + 25;
    for (let i = 0; i < total; i++) {
      const circular = await service.createCircular(TENANT_A, {
        title: `slip-${i}`,
        body: 'Return the signed slip.',
        audienceType: 'all',
        requiresAck: true,
        channels: ['in_app'],
        recipientIds: [`r-${i}`],
      });
      await service.ackCircularOnBehalf(TENANT_A, circular.id, `r-${i}`, {
        actorId: 'admin-1',
        reason: 'paper slip',
      });
    }
    expect(service.localAuditLog.length).toBe(CircularsService.MAX_LOCAL_AUDIT_ENTRIES);
  });

  it('rejects a concurrent second send so recipients are not double-delivered (PRC-M502)', async () => {
    const store = new InMemoryCircularStore();
    const service = new CircularsService(store);
    const circular = await service.createCircular(TENANT_A, {
      title: 'Exam schedule',
      body: 'Exams begin Monday.',
      audienceType: 'all',
      requiresAck: true,
      channels: ['in_app'],
      recipientIds: ['s1', 's2', 's3'],
    });

    const results = await Promise.allSettled([
      service.sendCircular(TENANT_A, circular.id),
      service.sendCircular(TENANT_A, circular.id),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

    // Exactly one delivery per recipient (3), not six.
    const logs = (await service.listDeliveryLogs(TENANT_A, { sourceType: 'circular' })).data;
    expect(logs).toHaveLength(3);
  });

  it('retries only failed delivery rows, resending the real circular body (PRC-M189/L088)', async () => {
    const store = new InMemoryCircularStore();
    const bodies: string[] = [];
    const service = new CircularsService(store, {
      whatsappAdapter: {
        async send(req) {
          bodies.push(req.body);
          return {
            mode: 'sandbox' as const,
            providerRef: `sandbox-wa:${req.recipientId}`,
            status: 'sent' as const,
            honestyNote: 'test',
          };
        },
      },
    });
    const circular = await service.createCircular(TENANT_A, {
      title: 'Reminder',
      body: 'Please submit forms by Friday.',
      audienceType: 'all',
      channels: ['whatsapp'],
      recipientIds: ['staff-9'],
    });
    const now = new Date();
    const failed = await store.createDeliveryLog({
      id: randomUUID(),
      tenantId: TENANT_A,
      channel: 'whatsapp',
      recipientId: 'staff-9',
      recipientLabel: null,
      status: 'failed',
      providerRef: null,
      sourceType: 'circular',
      sourceId: circular.id,
      errorMessage: 'sandbox simulated fail',
      queuedAt: now,
      sentAt: null,
      deliveredAt: null,
      failedAt: now,
      retriedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const retried = await service.retryFailed(TENANT_A, failed.id);
    expect(retried.status).toBe('sent');
    expect(retried.retriedAt).not.toBeNull();
    // PRC-L088: the retry must resend the real body, never an empty string.
    expect(bodies).toEqual(['Please submit forms by Friday.']);

    const sent = await store.createDeliveryLog({
      ...failed,
      id: randomUUID(),
      status: 'sent',
      errorMessage: null,
    });
    await expect(service.retryFailed(TENANT_A, sent.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it('fails closed (does not mark sent) when the retry cannot recover message content (PRC-L088)', async () => {
    const store = new InMemoryCircularStore();
    const service = new CircularsService(store);
    const now = new Date();
    // campaign source body is not recoverable from the log
    const failed = await store.createDeliveryLog({
      id: randomUUID(),
      tenantId: TENANT_A,
      channel: 'whatsapp',
      recipientId: 'staff-9',
      recipientLabel: null,
      status: 'failed',
      providerRef: null,
      sourceType: 'campaign',
      sourceId: randomUUID(),
      errorMessage: 'sandbox simulated fail',
      queuedAt: now,
      sentAt: null,
      deliveredAt: null,
      failedAt: now,
      retriedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await expect(service.retryFailed(TENANT_A, failed.id)).rejects.toBeInstanceOf(
      BusinessRuleError,
    );
    const after = (await service.listDeliveryLogs(TENANT_A, { status: 'failed' })).data;
    expect(after).toHaveLength(1);
    expect(after[0]!.status).toBe('failed');
    expect(after[0]!.providerRef).toBeNull();
  });
});
