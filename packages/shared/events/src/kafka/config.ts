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
