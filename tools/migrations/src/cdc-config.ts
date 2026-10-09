/**
 * PRC-M424 — CDC runner configuration loading and validation, extracted so it is
 * unit-testable without executing the runner's top-level `main()`.
 */
import type { CDCSyncConfig } from './cdc-sync.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const VALID_CONFLICT_POLICIES = ['source_wins', 'target_wins', 'latest_wins'] as const;

/** parseInt with a NaN/<=0 guard (PRC-M424): never silently fall through to NaN. */
export function requirePositiveInt(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}" (PRC-M424)`);
  }
  return n;
}

function isNonProdEnv(env: NodeJS.ProcessEnv): boolean {
  const node = (env.NODE_ENV ?? '').toLowerCase();
  return node === '' || node === 'development' || node === 'test';
}

/**
 * Builds a validated CDC config from env. Throws (fail fast) on a missing/invalid
 * tenant id, unknown conflict policy, non-numeric interval/batch size, or missing
 * Kafka brokers outside development — instead of the previous silent 'default'
 * tenant / localhost / unvalidated-cast behaviour (PRC-M424).
 */
export function loadCDCConfig(env: NodeJS.ProcessEnv = process.env): CDCSyncConfig {
  const tenantId = env.CDC_TENANT_ID?.trim();
  if (!tenantId) {
    throw new Error('CDC_TENANT_ID is required (no "default" fallback) (PRC-M424)');
  }
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`CDC_TENANT_ID must be a tenant uuid, got "${tenantId}" (PRC-M424)`);
  }

  const conflictRaw = env.CDC_CONFLICT_RESOLUTION?.trim() ?? 'target_wins';
  if (!(VALID_CONFLICT_POLICIES as readonly string[]).includes(conflictRaw)) {
    throw new Error(
      `CDC_CONFLICT_RESOLUTION must be one of ${VALID_CONFLICT_POLICIES.join(', ')}, got "${conflictRaw}" (PRC-M424)`,
    );
  }

  const brokersRaw = env.KAFKA_BROKERS?.trim();
  if (!brokersRaw && !isNonProdEnv(env)) {
    throw new Error('KAFKA_BROKERS is required outside development (PRC-M424)');
  }
  const kafkaBrokers = (brokersRaw ?? 'localhost:9092')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  return {
    kafkaBrokers,
    kafkaClientId: env.KAFKA_CLIENT_ID ?? 'proctira-cdc-producer',
    consumerGroupId: env.CDC_CONSUMER_GROUP ?? 'proctira-cdc-consumers',
    topicPrefix: env.CDC_TOPIC_PREFIX ?? 'cdc.migration',
    pollIntervalMs: requirePositiveInt('CDC_POLL_INTERVAL_MS', env.CDC_POLL_INTERVAL_MS, 5000),
    batchSize: requirePositiveInt('CDC_BATCH_SIZE', env.CDC_BATCH_SIZE, 1000),
    tenantId,
    conflictResolution: conflictRaw as CDCSyncConfig['conflictResolution'],
  };
}
