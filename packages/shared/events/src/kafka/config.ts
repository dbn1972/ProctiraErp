/**
 * Kafka configuration interface and defaults.
 */

import { buildTenantPrefixedName } from '../tenant-scope.js';

export interface KafkaConfig {
  /** Kafka broker addresses */
  brokers: string[];
  /** Client ID for this application instance */
  clientId: string;
  /** Consumer group ID */
  groupId?: string;
  /** Connection timeout in milliseconds */
  connectionTimeout?: number;
  /** Request timeout in milliseconds */
  requestTimeout?: number;
  /** Number of retries for failed operations */
  retries?: number;
  /** SSL configuration */
  ssl?: boolean;
  /** SASL authentication */
  sasl?: {
    mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
    username: string;
    password: string;
  };
}

export const DEFAULT_KAFKA_CONFIG: Partial<KafkaConfig> = {
  connectionTimeout: 10000,
  requestTimeout: 30000,
  retries: 5,
  ssl: false,
};

/**
 * Builds a tenant-prefixed topic name.
 * Format: tenant.{tenantId}.{topicName}
 * W1-SEC-11: fails closed when tenantId is missing/blank.
 */
export function buildTenantTopic(tenantId: string, topicName: string): string {
  return buildTenantPrefixedName(tenantId, topicName, 'events.buildTenantTopic');
}

const INSECURE_SASL_ALLOWED_ENVS = new Set(['development', 'test']);

/**
 * PRC-L492: validate brokers and refuse SASL credentials over plaintext.
 * SASL without `ssl` throws unless NODE_ENV is `development` or `test`.
 * Never includes credential values in the error.
 */
export function assertKafkaConfigSecure(
  config: KafkaConfig,
  nodeEnv: string | undefined = process.env['NODE_ENV'],
): void {
  if (
    !Array.isArray(config.brokers) ||
    config.brokers.length === 0 ||
    config.brokers.some((b) => typeof b !== 'string' || b.trim() === '')
  ) {
    throw new Error('Kafka config: brokers must be a non-empty list of host:port strings');
  }
  if (config.sasl) {
    if (!config.sasl.mechanism || !config.sasl.username || !config.sasl.password) {
      throw new Error('Kafka config: sasl requires mechanism, username and password');
    }
    if (!config.ssl && !INSECURE_SASL_ALLOWED_ENVS.has(nodeEnv ?? '')) {
      throw new Error(
        'Kafka config: SASL credentials require ssl=true outside development/test (PRC-L492)',
      );
    }
  }
}
