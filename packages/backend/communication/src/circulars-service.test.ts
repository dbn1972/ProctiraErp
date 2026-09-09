/**
 * G-922 circulars + ack rate + delivery log + tenant isolate.
 */
import { randomUUID } from 'node:crypto';

import { ConflictError, NotFoundError } from '@proctira/common';
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

    const logs = await service.listDeliveryLogs(TENANT_A, { channel: 'whatsapp' });
    expect(logs).toHaveLength(2);
    expect(logs.every((row) => row.status === 'sent')).toBe(true);
    expect(logs[0]!.providerRef).toMatch(/^sandbox-wa:/);

    const afterAck = await service.ackCircular(TENANT_A, circular.id, 'staff-1');
    expect(afterAck.ackCount).toBe(1);
    expect(afterAck.ackRate).toBe(0.5);

    expect(await service.listCirculars(TENANT_B)).toHaveLength(0);
    await expect(service.getCircular(TENANT_B, circular.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('retries only failed delivery rows', async () => {
    const store = new InMemoryCircularStore();
    const service = new CircularsService(store);
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
    const retried = await service.retryFailed(TENANT_A, failed.id);
    expect(retried.status).toBe('sent');
    expect(retried.retriedAt).not.toBeNull();

    const sent = await store.createDeliveryLog({
      ...failed,
      id: randomUUID(),
      status: 'sent',
      errorMessage: null,
    });
    await expect(service.retryFailed(TENANT_A, sent.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
