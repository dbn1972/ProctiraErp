/**
 * RabbitMQ configuration interface and defaults.
 */

import { buildTenantPrefixedName } from '../tenant-scope.js';

export interface RabbitMQConfig {
  /** RabbitMQ connection URL (amqp://user:pass@host:port/vhost) */
  url: string;
  /** Exchange name for publishing messages */
  exchange: string;
  /** Exchange type (direct, topic, fanout, headers) */
  exchangeType?: 'direct' | 'topic' | 'fanout' | 'headers';
  /** Dead-letter exchange name */
  deadLetterExchange?: string;
  /** Prefetch count for consumers (controls concurrency) */
  prefetchCount?: number;
  /** Whether exchanges and queues should survive broker restarts */
  durable?: boolean;
  /** Connection heartbeat interval in seconds */
  heartbeat?: number;
}

export const DEFAULT_RABBITMQ_CONFIG: Partial<RabbitMQConfig> = {
  exchangeType: 'topic',
  deadLetterExchange: 'dlx',
  prefetchCount: 10,
  durable: true,
  heartbeat: 60,
};

/**
 * Builds a tenant-prefixed queue name.
 * Format: tenant.{tenantId}.{queueName}
 * W1-SEC-11: fails closed when tenantId is missing/blank.
 */
export function buildTenantQueue(tenantId: string, queueName: string): string {
  return buildTenantPrefixedName(tenantId, queueName, 'events.buildTenantQueue');
}

/**
 * Builds a tenant-prefixed routing key.
 * Format: tenant.{tenantId}.{routingKey}
 * W1-SEC-11: fails closed when tenantId is missing/blank.
 */
export function buildTenantRoutingKey(tenantId: string, routingKey: string): string {
  return buildTenantPrefixedName(tenantId, routingKey, 'events.buildTenantRoutingKey');
}
