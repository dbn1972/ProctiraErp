/**
 * PRC-H110: the relay forwards only the remaining delay. Rows deferred via
 * availableAt already waited, so the full delay must not be applied twice.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueueAdapter } from '../../types';
import { InMemoryOutboxStore } from '../in-memory-outbox-store';
import { OutboxRelay } from '../relay';

function fakeQueue() {
  const dispatch = vi.fn(async () => undefined);
  return { dispatch, queue: { dispatch, publish: vi.fn() } as unknown as QueueAdapter };
}

describe('OutboxRelay remaining delay (PRC-H110)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes no broker delay once the deferred row is due', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const store = new InMemoryOutboxStore();
    await store.enqueue({
      id: 'row-1',
      tenantId: 'tenant-a',
      aggregateType: 'workflow_escalation',
      aggregateId: 'task-1',
      eventType: 'workflow.escalation',
      payload: {},
      metadata: { delay: 60_000 },
      dispatchMode: 'dispatch',
      availableAt: new Date('2026-01-01T00:01:00Z'),
    });
    const { dispatch, queue } = fakeQueue();
    const relay = new OutboxRelay({ store, queue });
    expect(await relay.tick()).toBe(0);
    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'));
    expect(await relay.tick()).toBe(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![1]).toEqual({});
  });

  it('forwards the remaining delay for a row published before it is due', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
    const store = new InMemoryOutboxStore();
    await store.enqueue({
      id: 'row-2',
      tenantId: 'tenant-a',
      aggregateType: 'workflow_escalation',
      aggregateId: 'task-2',
      eventType: 'workflow.escalation',
      payload: {},
      metadata: { delay: 60_000 },
      dispatchMode: 'dispatch',
    });
    vi.setSystemTime(new Date('2026-01-01T00:00:20Z'));
    const { dispatch, queue } = fakeQueue();
    const relay = new OutboxRelay({ store, queue });
    expect(await relay.tick()).toBe(1);
    expect(dispatch.mock.calls[0]![1]).toEqual({ delay: 40_000 });
  });
});
