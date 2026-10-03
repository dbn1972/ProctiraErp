/**
 * In-memory durable QueueAdapter for local/dev and restart-safe proofs.
 *
 * Messages survive adapter disconnect/reconnect when backed by a shared
 * {@link InMemoryDurableQueueStore}. Unacked (in-flight) deliveries are
 * reclaimed on disconnect — the same semantics RabbitMQ applies when a
 * consumer crashes before ack.
 */

import { randomUUID } from 'node:crypto';

import { assertTenantScopedSubscribeTopic } from '../tenant-scope';
import type {
  QueueAdapter,
  QueueMessage,
  PublishOptions,
  SubscribeOptions,
  MessageHandler,
  HealthCheckResult,
} from '../types';
import { buildTenantName, requestedDelayMs } from '../types';

import {
  DEFAULT_MAX_RETRIES,
  DeliveryFailureCounter,
  decideDisposition,
  errorMessage,
  reportDeliveryFailure,
  withIncrementedRetry,
  type DeliveryFailureEvent,
  type QueueConsumerLogger,
} from './delivery-failure';

export interface DurableQueuedMessage {
  deliveryTag: string;
  routingKey: string;
  message: QueueMessage;
  /** Epoch ms before which the message is not leased (PRC-M360 delayed delivery). */
  availableAt?: number;
}

/**
 * Shared durable store. Pass the same instance across adapter lifecycles
 * to simulate broker persistence across worker restarts.
 */
export class InMemoryDurableQueueStore {
  readonly pending: DurableQueuedMessage[] = [];
  readonly inFlight = new Map<string, DurableQueuedMessage>();
  /** Dead-letter queue (PRC-H086): exhausted deliveries keep the original payload. */
  readonly deadLetters: DurableQueuedMessage[] = [];

  /** Clock used for delayed delivery; injectable for tests. */
  constructor(private readonly now: () => number = () => Date.now()) {}

  enqueue(routingKey: string, message: QueueMessage, delayMs = 0): DurableQueuedMessage {
    const entry: DurableQueuedMessage = {
      deliveryTag: randomUUID(),
      routingKey,
      message,
      ...(delayMs > 0 ? { availableAt: this.now() + delayMs } : {}),
    };
    this.pending.push(entry);
    return entry;
  }

  private isDue(entry: DurableQueuedMessage): boolean {
    return entry.availableAt === undefined || entry.availableAt <= this.now();
  }

  lease(): DurableQueuedMessage | undefined {
    const idx = this.pending.findIndex((entry) => this.isDue(entry));
    if (idx < 0) return undefined;
    const [next] = this.pending.splice(idx, 1);
    if (!next) return undefined;
    this.inFlight.set(next.deliveryTag, next);
    return next;
  }

  /** Lease the first pending message whose routing key matches `pattern`. */
  leaseMatching(pattern: string): DurableQueuedMessage | undefined {
    const idx = this.pending.findIndex(
      (entry) => this.isDue(entry) && matchRoutingKey(pattern, entry.routingKey),
    );
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

  /**
   * Handler failure: requeue `retryMessage` at the tail (bounded retry) or move
   * the delivery to the dead-letter queue when no retry is given.
   */
  fail(deliveryTag: string, retryMessage?: QueueMessage): void {
    const entry = this.inFlight.get(deliveryTag);
    if (!entry) return;
    this.inFlight.delete(deliveryTag);
    if (retryMessage) {
      this.pending.push({ ...entry, deliveryTag: randomUUID(), message: retryMessage });
    } else {
      this.deadLetters.push(entry);
    }
  }

  get deadLetterCount(): number {
    return this.deadLetters.length;
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
  /** Retry budget when a message has no `metadata.maxRetries` (default 3). */
  defaultMaxRetries?: number;
  /** Structured logger for failed deliveries. */
  logger?: QueueConsumerLogger;
  /** Metric hook invoked once per failed delivery. */
  onDeliveryFailure?: (event: DeliveryFailureEvent) => void;
}

export class InMemoryDurableQueueAdapter implements QueueAdapter {
  private readonly store: InMemoryDurableQueueStore;
  private readonly pollIntervalMs: number;
  private connected = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private handler: MessageHandler | null = null;
  private consumeTopic: string | null = null;
  private draining = false;
  private readonly defaultMaxRetries: number;
  private readonly logger: QueueConsumerLogger | undefined;
  private readonly onDeliveryFailure: ((event: DeliveryFailureEvent) => void) | undefined;
  /** Failed-delivery counter (retried vs dead-lettered). */
  readonly failures = new DeliveryFailureCounter();

  constructor(options: InMemoryDurableQueueAdapterOptions = {}) {
    this.store = options.store ?? new InMemoryDurableQueueStore();
    this.pollIntervalMs = Math.max(5, options.pollIntervalMs ?? 10);
    this.defaultMaxRetries = options.defaultMaxRetries ?? DEFAULT_MAX_RETRIES;
    this.logger = options.logger;
    this.onDeliveryFailure = options.onDeliveryFailure;
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
    // PRC-M360: delayed messages are held until due (not delivered early).
    this.store.enqueue(routingKey, message, requestedDelayMs(message, options));
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
    // W1-SEC-11: reject unscoped caller topics / patterns (e.g. bare `#`).
    assertTenantScopedSubscribeTopic(options.topic, { surface: 'queue.memory.consume' });
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
        } catch (err: unknown) {
          if (this.connected && this.store.inFlight.has(entry.deliveryTag)) {
            // PRC-H086: bounded retry, then dead-letter (mirrors RabbitMQ adapter).
            const decision = decideDisposition(entry.message, this.defaultMaxRetries);
            this.store.fail(
              entry.deliveryTag,
              decision.disposition === 'retry' ? withIncrementedRetry(entry.message) : undefined,
            );
            reportDeliveryFailure(
              {
                messageId: entry.message.id,
                type: entry.message.type,
                tenantId: entry.message.tenantId,
                retryCount: decision.retryCount,
                maxRetries: decision.maxRetries,
                disposition: decision.disposition,
                error: errorMessage(err),
              },
              this.failures,
              this.logger,
              this.onDeliveryFailure,
            );
            // Yield so a retried message is redelivered on a later drain pass.
            break;
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
