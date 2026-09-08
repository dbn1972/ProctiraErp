/**
 * AWS SQS implementation of the QueueAdapter interface.
 * Maps publish/subscribe to SQS send/receive operations
 * with tenant-prefixed queue naming.
 */

import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  CreateQueueCommand,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';

import type {
  QueueAdapter,
  QueueMessage,
  PublishOptions,
  SubscribeOptions,
  MessageHandler,
  HealthCheckResult,
  SQSAdapterConfig,
} from '../types';
import { buildTenantName } from '../types';

const DEFAULT_CONFIG: Partial<SQSAdapterConfig> = {
  maxNumberOfMessages: 10,
  waitTimeSeconds: 20,
  visibilityTimeout: 30,
};

export class SQSAdapter implements QueueAdapter {
  private client: SQSClient | null = null;
  private config: SQSAdapterConfig;
  private connected = false;
  private pollingActive = false;
  private pollingTimers: ReturnType<typeof setTimeout>[] = [];
  private queueUrlCache: Map<string, string> = new Map();

  constructor(config: SQSAdapterConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    const clientConfig: Record<string, unknown> = {
      region: this.config.region,
    };

    if (this.config.endpoint) {
      clientConfig['endpoint'] = this.config.endpoint;
    }

    if (this.config.accessKeyId && this.config.secretAccessKey) {
      clientConfig['credentials'] = {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      };
    }

    this.client = new SQSClient(clientConfig);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;

    this.pollingActive = false;

    for (const timer of this.pollingTimers) {
      clearTimeout(timer);
    }
    this.pollingTimers = [];

    if (this.client) {
      this.client.destroy();
      this.client = null;
    }

    this.queueUrlCache.clear();
    this.connected = false;
  }

  async publish(message: QueueMessage, options?: PublishOptions): Promise<void> {
    if (!this.connected || !this.client) {
      throw new Error('SQSAdapter is not connected. Call connect() first.');
    }

    const queueName = options?.topic
      ? buildTenantName(message.tenantId, options.topic)
      : buildTenantName(message.tenantId, message.type);

    const queueUrl = await this.getOrCreateQueueUrl(queueName);

    const messageAttributes: Record<string, { DataType: string; StringValue: string }> = {
      tenantId: { DataType: 'String', StringValue: message.tenantId },
      messageType: { DataType: 'String', StringValue: message.type },
    };

    if (message.metadata?.correlationId) {
      messageAttributes['correlationId'] = {
        DataType: 'String',
        StringValue: message.metadata.correlationId,
      };
    }

    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        messageAttributes[key] = { DataType: 'String', StringValue: value };
      }
    }

    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      MessageAttributes: messageAttributes,
      DelaySeconds: options?.delay
        ? Math.min(Math.floor(options.delay / 1000), 900)
        : message.metadata?.delay
          ? Math.min(Math.floor(message.metadata.delay / 1000), 900)
          : undefined,
      MessageGroupId: message.tenantId,
      MessageDeduplicationId: message.id,
    });

    await this.client.send(command);
  }

  async subscribe(options: SubscribeOptions, handler: MessageHandler): Promise<void> {
    if (!this.connected || !this.client) {
      throw new Error('SQSAdapter is not connected. Call connect() first.');
    }

    const queueName = options.topic;
    const queueUrl = await this.getOrCreateQueueUrl(queueName);

    this.pollingActive = true;
    this.pollMessages(queueUrl, handler, options.concurrency ?? 10);
  }

  async dispatch(message: QueueMessage, options?: PublishOptions): Promise<void> {
    // In SQS, dispatch and publish are the same — send to a queue.
    // Competing consumers are achieved by multiple consumers polling the same queue.
    await this.publish(message, options);
  }

  async consume(options: SubscribeOptions, handler: MessageHandler): Promise<void> {
    // In SQS, consume and subscribe are the same — poll from a queue.
    // Competing consumers are achieved by multiple instances polling the same queue.
    await this.subscribe(options, handler);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();

    try {
      if (!this.connected || !this.client) {
        return {
          healthy: false,
          backend: 'sqs',
          latencyMs: Date.now() - start,
          error: 'Not connected',
        };
      }

      // Use a known queue URL from cache or try to list queues
      // Simple health check: try to get attributes of any cached queue
      if (this.queueUrlCache.size > 0) {
        const firstUrl = this.queueUrlCache.values().next().value as string;
        await this.client.send(
          new GetQueueAttributesCommand({
            QueueUrl: firstUrl,
            AttributeNames: ['ApproximateNumberOfMessages'],
          }),
        );
      }

      return {
        healthy: true,
        backend: 'sqs',
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        healthy: false,
        backend: 'sqs',
        latencyMs: Date.now() - start,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Get or create a queue URL, using a local cache to avoid repeated lookups.
   */
  private async getOrCreateQueueUrl(queueName: string): Promise<string> {
    const cached = this.queueUrlCache.get(queueName);
    if (cached) return cached;

    if (!this.client) {
      throw new Error('SQS client not initialized');
    }

    // Convert dots to hyphens for SQS queue naming (dots not allowed)
    const sqsQueueName = queueName.replace(/\./g, '-');

    try {
      const result = await this.client.send(new GetQueueUrlCommand({ QueueName: sqsQueueName }));
      const url = result.QueueUrl!;
      this.queueUrlCache.set(queueName, url);
      return url;
    } catch {
      // Queue doesn't exist, create it
      const isFifo = sqsQueueName.endsWith('.fifo');
      const attributes: Record<string, string> = {
        VisibilityTimeout: String(this.config.visibilityTimeout ?? 30),
        ReceiveMessageWaitTimeSeconds: String(this.config.waitTimeSeconds ?? 20),
      };

      if (isFifo) {
        attributes['FifoQueue'] = 'true';
        attributes['ContentBasedDeduplication'] = 'true';
      }

      const createResult = await this.client!.send(
        new CreateQueueCommand({
          QueueName: sqsQueueName,
          Attributes: attributes,
        }),
      );

      const url = createResult.QueueUrl!;
      this.queueUrlCache.set(queueName, url);
      return url;
    }
  }

  /**
   * Long-poll messages from an SQS queue and dispatch to handler.
   */
  private pollMessages(queueUrl: string, handler: MessageHandler, maxConcurrent: number): void {
    if (!this.pollingActive || !this.client) return;

    const poll = async (): Promise<void> => {
      if (!this.pollingActive || !this.client) return;

      try {
        const result = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: Math.min(maxConcurrent, this.config.maxNumberOfMessages ?? 10),
            WaitTimeSeconds: this.config.waitTimeSeconds ?? 20,
            MessageAttributeNames: ['All'],
          }),
        );

        if (result.Messages && result.Messages.length > 0) {
          const promises = result.Messages.map(async (sqsMessage) => {
            if (!sqsMessage.Body) return;

            try {
              const message = JSON.parse(sqsMessage.Body) as QueueMessage;
              await handler(message);

              // Delete message on successful processing
              if (this.client) {
                await this.client.send(
                  new DeleteMessageCommand({
                    QueueUrl: queueUrl,
                    ReceiptHandle: sqsMessage.ReceiptHandle!,
                  }),
                );
              }
            } catch {
              // Message will become visible again after visibility timeout
              // SQS handles retry via redrive policy
            }
          });

          await Promise.all(promises);
        }
      } catch {
        // Polling error — wait before retrying
      }

      // Schedule next poll
      if (this.pollingActive) {
        const timer = setTimeout(() => {
          void poll();
        }, 100);
        this.pollingTimers.push(timer);
      }
    };

    void poll();
  }
}
