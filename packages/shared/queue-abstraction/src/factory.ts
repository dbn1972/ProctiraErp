/**
 * Queue Adapter Factory.
 * Selects and instantiates the appropriate queue adapter
 * based on install-time configuration.
 */

import type { QueueAdapter, QueueAdapterConfig } from './types';
import { KafkaAdapter } from './adapters/kafka-adapter';
import { RabbitMQAdapter } from './adapters/rabbitmq-adapter';
import { SQSAdapter } from './adapters/sqs-adapter';

/**
 * Creates a QueueAdapter instance based on the provided configuration.
 * The `backend` field determines which implementation is instantiated.
 *
 * @param config - Queue adapter configuration specifying the backend and its settings
 * @returns A QueueAdapter instance for the configured backend
 * @throws Error if the backend is not supported or required config is missing
 *
 * @example
 * ```typescript
 * const adapter = createQueueAdapter({
 *   backend: 'kafka',
 *   kafka: {
 *     brokers: ['localhost:9092'],
 *     clientId: 'my-service',
 *     groupId: 'my-group',
 *   },
 * });
 *
 * await adapter.connect();
 * await adapter.publish(message);
 * ```
 */
export function createQueueAdapter(config: QueueAdapterConfig): QueueAdapter {
  switch (config.backend) {
    case 'kafka': {
      if (!config.kafka) {
        throw new Error(
          'Kafka configuration is required when backend is "kafka". ' +
            'Provide config.kafka with at least brokers and clientId.',
        );
      }
      return new KafkaAdapter(config.kafka);
    }

    case 'rabbitmq': {
      if (!config.rabbitmq) {
        throw new Error(
          'RabbitMQ configuration is required when backend is "rabbitmq". ' +
            'Provide config.rabbitmq with at least url and exchange.',
        );
      }
      return new RabbitMQAdapter(config.rabbitmq);
    }

    case 'sqs': {
      if (!config.sqs) {
        throw new Error(
          'SQS configuration is required when backend is "sqs". ' +
            'Provide config.sqs with at least region and queueUrlPrefix.',
        );
      }
      return new SQSAdapter(config.sqs);
    }

    default: {
      const exhaustiveCheck: never = config.backend;
      throw new Error(`Unsupported queue backend: "${exhaustiveCheck}"`);
    }
  }
}

/**
 * Creates a QueueAdapter from environment variables.
 * Reads QUEUE_BACKEND and backend-specific env vars.
 *
 * Environment variables:
 * - QUEUE_BACKEND: 'kafka' | 'rabbitmq' | 'sqs'
 *
 * Kafka:
 * - KAFKA_BROKERS: comma-separated broker addresses
 * - KAFKA_CLIENT_ID: client identifier
 * - KAFKA_GROUP_ID: consumer group ID
 * - KAFKA_SSL: 'true' | 'false'
 * - KAFKA_SASL_MECHANISM: 'plain' | 'scram-sha-256' | 'scram-sha-512'
 * - KAFKA_SASL_USERNAME: SASL username
 * - KAFKA_SASL_PASSWORD: SASL password
 *
 * RabbitMQ:
 * - RABBITMQ_URL: connection URL
 * - RABBITMQ_EXCHANGE: exchange name
 * - RABBITMQ_EXCHANGE_TYPE: exchange type
 * - RABBITMQ_DLX: dead-letter exchange name
 * - RABBITMQ_PREFETCH: prefetch count
 *
 * SQS:
 * - SQS_REGION: AWS region
 * - SQS_QUEUE_URL_PREFIX: queue URL prefix
 * - SQS_ACCESS_KEY_ID: AWS access key
 * - SQS_SECRET_ACCESS_KEY: AWS secret key
 * - SQS_ENDPOINT: custom endpoint (for LocalStack)
 */
export function createQueueAdapterFromEnv(): QueueAdapter {
  const backend = process.env['QUEUE_BACKEND'] as QueueAdapterConfig['backend'] | undefined;

  if (!backend) {
    throw new Error(
      'QUEUE_BACKEND environment variable is required. ' +
        'Set it to "kafka", "rabbitmq", or "sqs".',
    );
  }

  switch (backend) {
    case 'kafka': {
      const brokers = process.env['KAFKA_BROKERS'];
      const clientId = process.env['KAFKA_CLIENT_ID'];

      if (!brokers || !clientId) {
        throw new Error(
          'KAFKA_BROKERS and KAFKA_CLIENT_ID environment variables are required for Kafka backend.',
        );
      }

      const saslMechanism = process.env['KAFKA_SASL_MECHANISM'] as
        | 'plain'
        | 'scram-sha-256'
        | 'scram-sha-512'
        | undefined;
      const saslUsername = process.env['KAFKA_SASL_USERNAME'];
      const saslPassword = process.env['KAFKA_SASL_PASSWORD'];

      return createQueueAdapter({
        backend: 'kafka',
        kafka: {
          brokers: brokers.split(',').map((b) => b.trim()),
          clientId,
          groupId: process.env['KAFKA_GROUP_ID'],
          ssl: process.env['KAFKA_SSL'] === 'true',
          sasl:
            saslMechanism && saslUsername && saslPassword
              ? { mechanism: saslMechanism, username: saslUsername, password: saslPassword }
              : undefined,
        },
      });
    }

    case 'rabbitmq': {
      const url = process.env['RABBITMQ_URL'];
      const exchange = process.env['RABBITMQ_EXCHANGE'];

      if (!url || !exchange) {
        throw new Error(
          'RABBITMQ_URL and RABBITMQ_EXCHANGE environment variables are required for RabbitMQ backend.',
        );
      }

      return createQueueAdapter({
        backend: 'rabbitmq',
        rabbitmq: {
          url,
          exchange,
          exchangeType:
            (process.env['RABBITMQ_EXCHANGE_TYPE'] as 'direct' | 'topic' | 'fanout' | 'headers') ??
            'topic',
          deadLetterExchange: process.env['RABBITMQ_DLX'] ?? 'dlx',
          prefetchCount: process.env['RABBITMQ_PREFETCH']
            ? parseInt(process.env['RABBITMQ_PREFETCH'], 10)
            : 10,
        },
      });
    }

    case 'sqs': {
      const region = process.env['SQS_REGION'];
      const queueUrlPrefix = process.env['SQS_QUEUE_URL_PREFIX'];

      if (!region || !queueUrlPrefix) {
        throw new Error(
          'SQS_REGION and SQS_QUEUE_URL_PREFIX environment variables are required for SQS backend.',
        );
      }

      return createQueueAdapter({
        backend: 'sqs',
        sqs: {
          region,
          queueUrlPrefix,
          accessKeyId: process.env['SQS_ACCESS_KEY_ID'],
          secretAccessKey: process.env['SQS_SECRET_ACCESS_KEY'],
          endpoint: process.env['SQS_ENDPOINT'],
        },
      });
    }

    default:
      throw new Error(`Unsupported QUEUE_BACKEND value: "${backend}"`);
  }
}
