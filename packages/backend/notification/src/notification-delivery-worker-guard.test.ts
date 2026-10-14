/**
 * Unit tests for the notification-delivery worker message guard (PRC-L334).
 *
 * A foreign-typed message carrying a delivery-shaped payload must NOT trigger
 * a real send; it must be rejected (nack -> DLQ), not silently acked.
 */
import type {
  MessageHandler,
  QueueAdapter,
  QueueMessage,
  SubscribeOptions,
} from '@proctira/queue-abstraction';
import { NOTIFICATION_DELIVERY_JOB_TYPE } from '@proctira/queue-abstraction';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createNotificationDeliveryWorker,
  type NotificationDeliveryProcessor,
} from './notification-delivery-worker.js';

class FakeQueueAdapter implements QueueAdapter {
  handler: MessageHandler | null = null;
  private connected = false;
  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  async publish(): Promise<void> {}
  async subscribe(): Promise<void> {}
  async dispatch(): Promise<void> {}
  async consume(_o: SubscribeOptions, handler: MessageHandler): Promise<void> {
    this.handler = handler;
  }
  async healthCheck() {
    return { healthy: this.connected, status: this.connected ? 'up' : 'down' } as never;
  }
  isConnected(): boolean {
    return this.connected;
  }
}

function makeMessage(overrides: Partial<QueueMessage>): QueueMessage {
  return {
    id: 'm1',
    tenantId: 't1',
    type: NOTIFICATION_DELIVERY_JOB_TYPE,
    payload: { notificationId: 'n1', tenantId: 't1' },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('notification-delivery worker guard', () => {
  let adapter: FakeQueueAdapter;
  let process: ReturnType<typeof vi.fn>;
  let processor: NotificationDeliveryProcessor;

  beforeEach(async () => {
    adapter = new FakeQueueAdapter();
    process = vi.fn().mockResolvedValue(true);
    processor = {
      processQueuedDelivery:
        process as unknown as NotificationDeliveryProcessor['processQueuedDelivery'],
    };
    const worker = createNotificationDeliveryWorker({ queue: adapter, processor });
    await worker.start();
  });

  it('processes a well-formed delivery message', async () => {
    await adapter.handler!(makeMessage({}));
    expect(process).toHaveBeenCalledWith('t1', 'n1');
  });

  it('rejects a foreign-typed message carrying a delivery-shaped payload (PRC-L334)', async () => {
    await expect(
      adapter.handler!(
        makeMessage({
          type: 'student.enrolled',
          payload: { notificationId: 'n1', tenantId: 't1' },
        }),
      ),
    ).rejects.toThrow(/Unexpected notification delivery message/);
    expect(process).not.toHaveBeenCalled();
  });

  it('rejects a correctly-typed message with a malformed payload (PRC-L334)', async () => {
    await expect(adapter.handler!(makeMessage({ payload: { nope: true } }))).rejects.toThrow(
      /Unexpected notification delivery message/,
    );
    expect(process).not.toHaveBeenCalled();
  });
});
