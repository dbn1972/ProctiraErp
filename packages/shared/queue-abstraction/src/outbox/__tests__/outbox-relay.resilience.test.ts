/**
 * PRC-M363: relay ticks never raise unhandled rejections; stop() waits for the
 * in-flight tick before draining.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryDurableQueueAdapter, InMemoryDurableQueueStore } from '../../index.js';
import { InMemoryOutboxStore } from '../in-memory-outbox-store.js';
import { OutboxRelay } from '../relay.js';
import type { OutboxStore } from '../store.js';

function failingStore(base: OutboxStore, failures: number): OutboxStore {
  let remaining = failures;
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'claimPending') {
        return async (n: number) => {
          if (remaining > 0) {
            remaining -= 1;
            throw new Error('db down');
          }
          return target.claimPending(n);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

describe('OutboxRelay resilience (PRC-M363)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('claimPending rejection is logged, does not reject, and the next tick runs', async () => {
    const queue = new InMemoryDurableQueueAdapter({ store: new InMemoryDurableQueueStore() });
    await queue.connect();
    const store = failingStore(new InMemoryOutboxStore(), 1);
    const error = vi.fn();
    const relay = new OutboxRelay({ store, queue, logger: { error } });
    await expect(relay.tick()).resolves.toBe(0);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'db down' }),
      'outbox claimPending failed',
    );
    await expect(relay.tick()).resolves.toBe(0);
    await queue.disconnect();
  });

  it('interval ticks with a failing store raise no unhandledRejection', async () => {
    const queue = new InMemoryDurableQueueAdapter({ store: new InMemoryDurableQueueStore() });
    await queue.connect();
    const store = failingStore(new InMemoryOutboxStore(), 1000);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const relay = new OutboxRelay({ store, queue, pollIntervalMs: 5, logger: { error: vi.fn() } });
    relay.start();
    await new Promise((r) => setTimeout(r, 40));
    await relay.stop();
    await new Promise((r) => setTimeout(r, 5));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    await queue.disconnect();
  });

  it('connect() failure on start is logged, not thrown', async () => {
    const queue = new InMemoryDurableQueueAdapter({ store: new InMemoryDurableQueueStore() });
    vi.spyOn(queue, 'connect').mockRejectedValue(new Error('broker down'));
    const error = vi.fn();
    const relay = new OutboxRelay({
      store: new InMemoryOutboxStore(),
      queue,
      pollIntervalMs: 1000,
      logger: { error },
    });
    relay.start();
    await new Promise((r) => setTimeout(r, 5));
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: 'broker down' }),
      'outbox queue connect failed',
    );
    await relay.stop();
  });

  it('stop() waits for the in-flight tick before draining', async () => {
    const queue = new InMemoryDurableQueueAdapter({ store: new InMemoryDurableQueueStore() });
    await queue.connect();
    const base = new InMemoryOutboxStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const order: string[] = [];
    let calls = 0;
    const store = new Proxy(base, {
      get(target, prop, receiver) {
        if (prop === 'claimPending') {
          return async (n: number) => {
            calls += 1;
            const call = calls;
            order.push(`claim-start-${call}`);
            if (call === 1) await gate;
            order.push(`claim-end-${call}`);
            return target.claimPending(n);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    }) as OutboxStore;
    const relay = new OutboxRelay({ store, queue });
    const first = relay.tick();
    const stopped = relay.stop();
    await new Promise((r) => setTimeout(r, 5));
    expect(order).toEqual(['claim-start-1']);
    release();
    await stopped;
    await first;
    expect(order).toEqual(['claim-start-1', 'claim-end-1', 'claim-start-2', 'claim-end-2']);
    await queue.disconnect();
  });
});
