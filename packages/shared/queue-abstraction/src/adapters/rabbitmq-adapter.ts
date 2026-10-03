/**
 * RabbitMQ implementation of the QueueAdapter interface.
 * Maps publish/subscribe to RabbitMQ exchanges/queues
 * with tenant-prefixed naming conventions.
 */

import type { ChannelModel, ConfirmChannel, ConsumeMessage, Message, Options } from 'amqplib';
import amqplib from 'amqplib';

import { checkQueueEnvelope } from '../envelope';
import { assertTenantScopedSubscribeTopic } from '../tenant-scope';
import type {
  QueueAdapter,
  QueueMessage,
  PublishOptions,
  SubscribeOptions,
  MessageHandler,
  HealthCheckResult,
  RabbitMQAdapterConfig,
} from '../types';
import { buildTenantName } from '../types';

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

const DEFAULT_CONFIG: Partial<RabbitMQAdapterConfig> = {
  exchangeType: 'topic',
  deadLetterExchange: 'dlx',
  prefetchCount: 10,
  durable: true,
  heartbeat: 60,
};

export interface RabbitMQAdapterRuntimeOptions {
  /** Retry budget when a message has no `metadata.maxRetries` (default 3). */
  defaultMaxRetries?: number;
  /** Structured logger for failed deliveries / returned publishes. */
  logger?: QueueConsumerLogger;
  /** Metric hook invoked once per failed delivery. */
  onDeliveryFailure?: (event: DeliveryFailureEvent) => void;
}

/** Name of the queue bound (`#`) to the dead-letter exchange (PRC-H086). */
export function deadLetterQueueName(deadLetterExchange: string): string {
  return `${deadLetterExchange}.dlq`;
}

/**
 * Header carrying the original tenant routing key on retries republished via
 * the default exchange (whose routing key is the queue name) — PRC-L355.
 */
export const ROUTE_HEADER = 'x-proctira-route';

/** Routing key the tenant check must use for a delivery. */
export function effectiveRoutingKey(msg: Pick<ConsumeMessage, 'fields' | 'properties'>): string {
  if (msg.fields.exchange === '') {
    const header = (msg.properties?.headers as Record<string, unknown> | undefined)?.[ROUTE_HEADER];
    return typeof header === 'string' ? header : msg.fields.routingKey;
  }
  return msg.fields.routingKey;
}

interface PendingPublish {
  reject: (err: Error) => void;
  returned: boolean;
}

export class RabbitMQAdapter implements QueueAdapter {
  private config: RabbitMQAdapterConfig;
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;
  private connected = false;
  private readonly defaultMaxRetries: number;
  private readonly logger: QueueConsumerLogger | undefined;
  private readonly onDeliveryFailure: ((event: DeliveryFailureEvent) => void) | undefined;
  /** In-flight publishes keyed by messageId, used to correlate basic.return (PRC-H087). */
  private readonly pendingPublishes = new Map<string, Set<PendingPublish>>();
  /** Failed-delivery counter (retried vs dead-lettered). */
  readonly failures = new DeliveryFailureCounter();

  constructor(config: RabbitMQAdapterConfig, runtime: RabbitMQAdapterRuntimeOptions = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config } as RabbitMQAdapterConfig;
    this.defaultMaxRetries = runtime.defaultMaxRetries ?? DEFAULT_MAX_RETRIES;
    this.logger = runtime.logger;
    this.onDeliveryFailure = runtime.onDeliveryFailure;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.connection = await amqplib.connect(this.config.url, {
      heartbeat: this.config.heartbeat,
    });

    // PRC-H087: confirm channel so publish resolves only after broker ack.
    const channel = await this.connection.createConfirmChannel();
    this.channel = channel;
    await channel.prefetch(this.config.prefetchCount ?? 10);

    // Unroutable mandatory publishes come back as basic.return before the ack.
    channel.on('return', (msg: Message) => {
      const id = msg.properties?.messageId as string | undefined;
      for (const pending of (id ? this.pendingPublishes.get(id) : undefined) ?? []) {
        pending.returned = true;
      }
      this.logger?.error?.(
        { messageId: id, routingKey: msg.fields?.routingKey },
        'queue publish returned unroutable',
      );
    });
    // Connection/channel loss: fail every in-flight publish (row stays pending).
    const failAll = (reason: string) => {
      const all = [...this.pendingPublishes.values()].flatMap((set) => [...set]);
      this.pendingPublishes.clear();
      for (const pending of all) {
        pending.reject(new Error(`RabbitMQ publish not confirmed: ${reason}`));
      }
      this.connected = false;
    };
    channel.on('close', () => failAll('channel closed'));
    channel.on('error', (err: unknown) => failAll(errorMessage(err)));

    // Assert the main exchange
    await channel.assertExchange(this.config.exchange, this.config.exchangeType ?? 'topic', {
      durable: this.config.durable ?? true,
    });

    // Assert the dead-letter exchange + a bound DLQ so dead letters are retained (PRC-H086).
    if (this.config.deadLetterExchange) {
      await channel.assertExchange(this.config.deadLetterExchange, 'topic', {
        durable: this.config.durable ?? true,
      });
      const dlq = deadLetterQueueName(this.config.deadLetterExchange);
      await channel.assertQueue(dlq, { durable: this.config.durable ?? true });
      await channel.bindQueue(dlq, this.config.deadLetterExchange, '#');
    }

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected && !this.channel && !this.connection) return;

    if (this.channel) {
      await this.channel.close().catch(() => undefined);
      this.channel = null;
    }
    if (this.connection) {
      await this.connection.close().catch(() => undefined);
      this.connection = null;
    }

    this.connected = false;
  }

  async publish(message: QueueMessage, options?: PublishOptions): Promise<void> {
    await this.publishInternal(message, options, false);
  }

  private async publishInternal(
    message: QueueMessage,
    options: PublishOptions | undefined,
    mandatory: boolean,
  ): Promise<void> {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQAdapter is not connected. Call connect() first.');
    }

    const routingKey = options?.topic
      ? buildTenantName(message.tenantId, options.topic)
      : buildTenantName(message.tenantId, message.type);

    const publishOptions: Options.Publish = {
      persistent: true,
      mandatory,
      priority: options?.priority ?? message.metadata?.priority ?? 5,
      headers: {
        'x-tenant-id': message.tenantId,
        'x-message-type': message.type,
        'x-correlation-id': message.metadata?.correlationId ?? '',
        ...(options?.headers ?? {}),
      },
      messageId: message.id,
      contentType: 'application/json',
      timestamp: Date.now(),
    };

    if (options?.delay ?? message.metadata?.delay) {
      const delay = options?.delay ?? message.metadata?.delay ?? 0;
      (publishOptions.headers as Record<string, unknown>)['x-delay'] = delay;
      publishOptions.expiration = String(delay);
    }

    await this.confirmedSend(message.id, (cb) =>
      this.channel!.publish(
        this.config.exchange,
        routingKey,
        Buffer.from(JSON.stringify(message)),
        publishOptions,
        cb,
      ),
    );
  }

  /**
   * PRC-H087: resolve only after broker confirm; reject on nack, basic.return
   * (unroutable mandatory publish), or channel loss. Honours write backpressure.
   */
  private async confirmedSend(
    messageId: string,
    send: (cb: (err: unknown) => void) => boolean,
  ): Promise<void> {
    const channel = this.channel!;
    let written = true;
    await new Promise<void>((resolve, reject) => {
      const pending: PendingPublish = { reject, returned: false };
      const untrack = () => {
        const set = this.pendingPublishes.get(messageId);
        set?.delete(pending);
        if (set && set.size === 0) this.pendingPublishes.delete(messageId);
      };
      const set = this.pendingPublishes.get(messageId) ?? new Set<PendingPublish>();
      set.add(pending);
      this.pendingPublishes.set(messageId, set);
      try {
        written = send((err: unknown) => {
          untrack();
          if (err) {
            reject(new Error(`RabbitMQ publish nacked: ${errorMessage(err)}`));
          } else if (pending.returned) {
            reject(new Error(`RabbitMQ publish unroutable (no bound queue) for ${messageId}`));
          } else {
            resolve();
          }
        });
      } catch (err: unknown) {
        untrack();
        reject(err instanceof Error ? err : new Error(errorMessage(err)));
      }
    });
    if (!written) {
      await new Promise<void>((resolve) => channel.once('drain', () => resolve()));
    }
  }

  async subscribe(options: SubscribeOptions, handler: MessageHandler): Promise<void> {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQAdapter is not connected. Call connect() first.');
    }

    // W1-SEC-11: reject unscoped caller topics / binding patterns.
    assertTenantScopedSubscribeTopic(options.topic, { surface: 'queue.rabbitmq.subscribe' });

    const queueName = buildTenantName(options.groupId ?? 'shared', `sub.${options.topic}`);
    await this.consumeQueue(queueName, options, handler);
  }

  async dispatch(message: QueueMessage, options?: PublishOptions): Promise<void> {
    // Dispatch uses the same exchange; competing consumers share one queue.
    // PRC-H087: mandatory — a task with no bound work queue must reject so the
    // outbox row is not marked published.
    await this.publishInternal(message, options, true);
  }

  async consume(options: SubscribeOptions, handler: MessageHandler): Promise<void> {
    if (!this.connected || !this.channel) {
      throw new Error('RabbitMQAdapter is not connected. Call connect() first.');
    }

    // W1-SEC-11: reject unscoped caller topics / binding patterns.
    assertTenantScopedSubscribeTopic(options.topic, { surface: 'queue.rabbitmq.consume' });

    // For consume (competing consumers), use a shared queue name
    const queueName = buildTenantName(options.groupId ?? 'workers', `task.${options.topic}`);
    await this.consumeQueue(queueName, options, handler);
  }

  private async consumeQueue(
    queueName: string,
    options: SubscribeOptions,
    handler: MessageHandler,
  ): Promise<void> {
    const channel = this.channel!;

    // Assert queue with dead-letter exchange
    await channel.assertQueue(queueName, {
      durable: this.config.durable ?? true,
      arguments: {
        'x-dead-letter-exchange': this.config.deadLetterExchange ?? '',
        'x-max-priority': 10,
      },
    });

    // Bind queue to exchange with the topic as routing key pattern
    await channel.bindQueue(queueName, this.config.exchange, options.topic);

    const autoAck = options.autoAck ?? false;

    await channel.consume(
      queueName,
      (msg: ConsumeMessage | null) => {
        if (!msg) return;
        void this.handleDelivery(channel, queueName, msg, handler, autoAck);
      },
      { noAck: autoAck },
    );
  }

  private async handleDelivery(
    channel: ConfirmChannel,
    queueName: string,
    msg: ConsumeMessage,
    handler: MessageHandler,
    autoAck: boolean,
  ): Promise<void> {
    let message: QueueMessage | undefined;
    // PRC-L355: zod envelope + body tenant must equal the routed tenant; a
    // failing delivery is dead-lettered without reaching the handler.
    let body: unknown;
    try {
      body = JSON.parse(msg.content.toString());
    } catch {
      body = undefined;
    }
    const route = effectiveRoutingKey(msg);
    const envelope = checkQueueEnvelope(body, route);
    if (!envelope.ok) {
      reportDeliveryFailure(
        {
          messageId: msg.properties?.messageId as string | undefined,
          type: undefined,
          tenantId: undefined,
          retryCount: 0,
          maxRetries: 0,
          disposition: 'dead-letter',
          error: envelope.reason,
        },
        this.failures,
        this.logger,
        this.onDeliveryFailure,
      );
      if (!autoAck) channel.nack(msg, false, false);
      return;
    }
    try {
      message = envelope.message;
      await handler(message);
      if (!autoAck) channel.ack(msg);
      return;
    } catch (err: unknown) {
      const decision = decideDisposition(message, this.defaultMaxRetries);
      reportDeliveryFailure(
        {
          messageId: message?.id ?? (msg.properties?.messageId as string | undefined),
          type: message?.type,
          tenantId: message?.tenantId,
          retryCount: decision.retryCount,
          maxRetries: decision.maxRetries,
          disposition: decision.disposition,
          error: errorMessage(err),
        },
        this.failures,
        this.logger,
        this.onDeliveryFailure,
      );
      if (autoAck) return; // Broker already considers it delivered.
      if (decision.disposition === 'retry' && message) {
        try {
          // Republish straight to the same work queue (default exchange) with
          // retryCount+1, confirmed, then ack the original delivery.
          const retry = withIncrementedRetry(message);
          await this.confirmedSend(`${retry.id}#retry${decision.retryCount + 1}`, (cb) =>
            channel.sendToQueue(
              queueName,
              Buffer.from(JSON.stringify(retry)),
              {
                ...msg.properties,
                headers: { ...(msg.properties?.headers ?? {}), [ROUTE_HEADER]: route },
                persistent: true,
              },
              cb,
            ),
          );
          channel.ack(msg);
          return;
        } catch {
          // Could not re-enqueue: requeue original so the job is never lost.
          channel.nack(msg, false, true);
          return;
        }
      }
      // Exhausted → dead-letter exchange → DLQ, original payload preserved.
      channel.nack(msg, false, false);
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();

    try {
      if (!this.connected || !this.channel) {
        return {
          healthy: false,
          backend: 'rabbitmq',
          latencyMs: Date.now() - start,
          error: 'Not connected',
        };
      }

      // Check connection by asserting a temporary queue
      await this.channel.checkExchange(this.config.exchange);

      return {
        healthy: true,
        backend: 'rabbitmq',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        healthy: false,
        backend: 'rabbitmq',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
