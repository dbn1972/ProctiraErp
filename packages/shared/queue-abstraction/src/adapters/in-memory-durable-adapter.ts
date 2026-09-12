/**
 * In-memory durable QueueAdapter for local/dev and restart-safe proofs.
 *
 * Messages survive adapter disconnect/reconnect when backed by a shared
 * {@link InMemoryDurableQueueStore}. Unacked (in-flight) deliveries are
 * reclaimed on disconnect — the same semantics RabbitMQ applies when a
 * consumer crashes before ack.
 */

import { randomUUID } from 'node:crypto';

import type {
  QueueAdapter,
  QueueMessage,
  PublishOptions,
  SubscribeOptions,
  MessageHandler,
  HealthCheckResult,
} from '../types';
import { buildTenantName } from '../types';

export interface DurableQueuedMessage {
  deliveryTag: string;
  routingKey: string;
  message: QueueMessage;
}

/**
 * Shared durable store. Pass the same instance across adapter lifecycles
 * to simulate broker persistence across worker restarts.
 */
export class InMemoryDurableQueueStore {
  readonly pending: DurableQueuedMessage[] = [];
  readonly inFlight = new Map<string, DurableQueuedMessage>();

  enqueue(routingKey: string, message: QueueMessage): DurableQueuedMessage {
    const entry: DurableQueuedMessage = {
      deliveryTag: randomUUID(),
      routingKey,
      message,
    };
    this.pending.push(entry);
    return entry;
  }

  lease(): DurableQueuedMessage | undefined {
    const next = this.pending.shift();
    if (!next) return undefined;
    this.inFlight.set(next.deliveryTag, next);
    return next;
  }

  /** Lease the first pending message whose routing key matches `pattern`. */
  leaseMatching(pattern: string): DurableQueuedMessage | undefined {
    const idx = this.pending.findIndex((entry) => matchRoutingKey(pattern, entry.routingKey));
    if (idx < 0) return undefined;
    const [next] = this.pending.splice(idx, 1);
    if (!next) return undefined;
    this.inFlight.set(next.deliveryTag, next);
    return next;
  }

  ack(deliveryTag: string): void {
    this.inFlight.delete(deliveryTag);
  }

  nack(deliveryTag: string, requeue: boolean): void {
    const entry = this.inFlight.get(deliveryTag);
    if (!entry) return;
    this.inFlight.delete(deliveryTag);
    if (requeue) {
      this.pending.unshift(entry);
    }
  }

  /** Move all in-flight messages back to pending (consumer crash). */
  reclaimInFlight(): number {
    let count = 0;
    for (const entry of this.inFlight.values()) {
      this.pending.unshift(entry);
      count += 1;
    }
    this.inFlight.clear();
    return count;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get inFlightCount(): number {
    return this.inFlight.size;
  }
}

/**
 * RabbitMQ-style topic match: `*` = one dot segment, `#` = zero or more segments.
 */
export function matchRoutingKey(pattern: string, routingKey: string): boolean {
  if (pattern === routingKey) return true;
  const patternParts = pattern.split('.');
  const keyParts = routingKey.split('.');
  let pi = 0;
  let ki = 0;
  while (pi < patternParts.length && ki < keyParts.length) {
    const part = patternParts[pi]!;
    if (part === '#') {
      if (pi === patternParts.length - 1) return true;
      const rest = patternParts.slice(pi + 1).join('.');
      for (let skip = ki; skip <= keyParts.length; skip += 1) {
        if (matchRoutingKey(rest, keyParts.slice(skip).join('.'))) return true;
      }
      return false;
    }
    if (part !== '*' && part !== keyParts[ki]) return false;
    pi += 1;
    ki += 1;
  }
  while (pi < patternParts.length && patternParts[pi] === '#') pi += 1;
  return pi === patternParts.length && ki === keyParts.length;
}

export interface InMemoryDurableQueueAdapterOptions {
  /** Shared store for restart simulation across adapter instances. */
  store?: InMemoryDurableQueueStore;
  /** Poll interval when draining the queue (ms). */
  pollIntervalMs?: number;
}

export class InMemoryDurableQueueAdapter implements QueueAdapter {
  private readonly store: InMemoryDurableQueueStore;
  private readonly pollIntervalMs: number;
  private connected = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private handler: MessageHandler | null = null;
  private consumeTopic: string | null = null;
  private draining = false;

  constructor(options: InMemoryDurableQueueAdapterOptions = {}) {
    this.store = options.store ?? new InMemoryDurableQueueStore();
    this.pollIntervalMs = Math.max(5, options.pollIntervalMs ?? 10);
  }

  /** Expose store for test assertions / multi-adapter restarts. */
  getQueueStore(): InMemoryDurableQueueStore {
    return this.store;
  }

  async connect(): Promise<void> {
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    // Crash semantics: unacked work returns to the durable pending queue.
    this.store.reclaimInFlight();
    this.handler = null;
    this.consumeTopic = null;
    this.connected = false;
  }

  async publish(message: QueueMessage, options?: PublishOptions): Promise<void> {
    if (!this.connected) {
      throw new Error('InMemoryDurableQueueAdapter is not connected. Call connect() first.');
    }
    const routingKey = options?.topic
      ? buildTenantName(message.tenantId, options.topic)
      : buildTenantName(message.tenantId, message.type);
    this.store.enqueue(routingKey, message);
  }

  async subscribe(options: SubscribeOptions, handler: MessageHandler): Promise<void> {
    await this.consume(options, handler);
  }

  async dispatch(message: QueueMessage, options?: PublishOptions): Promise<void> {
    await this.publish(message, options);
  }

  async consume(options: SubscribeOptions, handler: MessageHandler): Promise<void> {
    if (!this.connected) {
      throw new Error('InMemoryDurableQueueAdapter is not connected. Call connect() first.');
    }
    this.handler = handler;
    this.consumeTopic = options.topic;
    if (!this.pollTimer) {
      this.pollTimer = setInterval(() => {
        void this.drainOnce(options.autoAck ?? false);
      }, this.pollIntervalMs);
      this.pollTimer.unref?.();
    }
    // Opportunistic immediate drain — do not await handlers (consume must return
    // like a broker consumer registration; pending work continues in background).
    void this.drainOnce(options.autoAck ?? false);
  }

  private async drainOnce(autoAck: boolean): Promise<void> {
    if (!this.connected || !this.handler || !this.consumeTopic || this.draining) return;
    this.draining = true;
    try {
      const topic = this.consumeTopic;
      // Drain currently matching pending messages.
      for (;;) {
        const entry = this.store.leaseMatching(topic);
        if (!entry) break;
        try {
          await this.handler(entry.message);
          // Only ack if we still own the delivery (disconnect may have reclaimed).
          if (this.connected && this.store.inFlight.has(entry.deliveryTag)) {
            this.store.ack(entry.deliveryTag);
          }
        } catch {
          if (this.connected && this.store.inFlight.has(entry.deliveryTag)) {
            // Handler failure → dead-letter (drop) to mirror RabbitMQ adapter.
            this.store.nack(entry.deliveryTag, false);
          }
        }
        // autoAck is accepted for interface parity; ack still happens after success.
        void autoAck;
      }
    } finally {
      this.draining = false;
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return {
      healthy: this.connected,
      backend: 'memory-durable',
      latencyMs: 0,
      error: this.connected ? undefined : 'Not connected',
    };
  }

  isConnected(): boolean {
    return this.connected;
  }
}
