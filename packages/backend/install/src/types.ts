/**
 * Core types for the Install/Bootstrap Service.
 *
 * Defines the interfaces for first-run configuration,
 * adapter validation, and health check aggregation.
 */

import { Type, Static } from '@sinclair/typebox';

// ─── Bootstrap Steps ─────────────────────────────────────────────────────────

/**
 * The ordered steps in the bootstrap configuration flow.
 * Each step must be completed before proceeding to the next.
 */
export const BOOTSTRAP_STEPS = ['cdn', 'database', 'storage', 'cache', 'queue'] as const;
export type BootstrapStep = (typeof BOOTSTRAP_STEPS)[number];

/**
 * Status of an individual adapter configuration.
 */
export type AdapterStatus = 'configured' | 'pending' | 'failed';

// ─── Configuration Schemas ───────────────────────────────────────────────────

export const CdnConfigSchema = Type.Object({
  adapter: Type.Union([Type.Literal('cloudfront'), Type.Literal('nginx'), Type.Literal('custom')]),
  baseUrl: Type.String({ minLength: 1 }),
  tenantAware: Type.Boolean({ default: true }),
  brandingPrefix: Type.Optional(Type.String()),
  staticPrefix: Type.Optional(Type.String()),
  cloudfront: Type.Optional(
    Type.Object({
      distributionId: Type.String(),
      region: Type.Optional(Type.String()),
    }),
  ),
  custom: Type.Optional(
    Type.Object({
      invalidationEndpoint: Type.Optional(Type.String()),
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    }),
  ),
});

export const DatabaseConfigSchema = Type.Object({
  provider: Type.Union([Type.Literal('postgresql'), Type.Literal('mysql')]),
  host: Type.String({ minLength: 1 }),
  port: Type.Number({ minimum: 1, maximum: 65535 }),
  database: Type.String({ minLength: 1 }),
  username: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 1 }),
  ssl: Type.Optional(Type.Boolean()),
  poolSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
});

export const StorageConfigSchema = Type.Object({
  adapter: Type.Union([Type.Literal('s3'), Type.Literal('minio')]),
  bucket: Type.String({ minLength: 1 }),
  region: Type.Optional(Type.String()),
  endpoint: Type.Optional(Type.String()),
  accessKeyId: Type.Optional(Type.String()),
  secretAccessKey: Type.Optional(Type.String()),
  forcePathStyle: Type.Optional(Type.Boolean()),
  useSSL: Type.Optional(Type.Boolean()),
});

export const CacheConfigSchema = Type.Object({
  adapter: Type.Union([Type.Literal('redis'), Type.Literal('memory')]),
  host: Type.Optional(Type.String()),
  port: Type.Optional(Type.Number({ minimum: 1, maximum: 65535 })),
  password: Type.Optional(Type.String()),
  db: Type.Optional(Type.Number({ minimum: 0, maximum: 15 })),
  tls: Type.Optional(Type.Boolean()),
  keyPrefix: Type.Optional(Type.String()),
});

export const QueueConfigSchema = Type.Object({
  backend: Type.Union([Type.Literal('kafka'), Type.Literal('rabbitmq'), Type.Literal('sqs')]),
  kafka: Type.Optional(
    Type.Object({
      brokers: Type.Array(Type.String(), { minItems: 1 }),
      clientId: Type.String({ minLength: 1 }),
      groupId: Type.Optional(Type.String()),
      ssl: Type.Optional(Type.Boolean()),
    }),
  ),
  rabbitmq: Type.Optional(
    Type.Object({
      url: Type.String({ minLength: 1 }),
      exchange: Type.String({ minLength: 1 }),
      exchangeType: Type.Optional(
        Type.Union([
          Type.Literal('direct'),
          Type.Literal('topic'),
          Type.Literal('fanout'),
          Type.Literal('headers'),
        ]),
      ),
    }),
  ),
  sqs: Type.Optional(
    Type.Object({
      region: Type.String({ minLength: 1 }),
      queueUrlPrefix: Type.String({ minLength: 1 }),
      accessKeyId: Type.Optional(Type.String()),
      secretAccessKey: Type.Optional(Type.String()),
      endpoint: Type.Optional(Type.String()),
    }),
  ),
});

// ─── Inferred Types ──────────────────────────────────────────────────────────

export type CdnConfigInput = Static<typeof CdnConfigSchema>;
export type DatabaseConfigInput = Static<typeof DatabaseConfigSchema>;
export type StorageConfigInput = Static<typeof StorageConfigSchema>;
export type CacheConfigInput = Static<typeof CacheConfigSchema>;
export type QueueConfigInput = Static<typeof QueueConfigSchema>;

// ─── Result Types ────────────────────────────────────────────────────────────

/**
 * Result of validating and testing an adapter configuration.
 */
export interface ValidationResult {
  /** Whether the configuration is valid and connectivity was confirmed */
  success: boolean;
  /** The step that was validated */
  step: BootstrapStep;
  /** Human-readable message */
  message: string;
  /** Latency of the connectivity test in milliseconds */
  latencyMs?: number;
  /** Error details if validation failed */
  error?: string;
}

/**
 * Overall bootstrap status returned by the status endpoint.
 */
export interface BootstrapStatus {
  /** Whether all steps have been completed successfully */
  isComplete: boolean;
  /** Steps that have been configured and validated */
  completedSteps: BootstrapStep[];
  /** Steps that still need to be configured */
  pendingSteps: BootstrapStep[];
  /** Status of each adapter */
  adapterStatuses: Record<BootstrapStep, AdapterStatus>;
  /** Timestamp of last bootstrap run (if any) */
  lastRunAt?: string;
  /** ID of the last bootstrap run */
  lastRunId?: string;
}

/**
 * Result of finalizing the bootstrap process.
 */
export interface BootstrapResult {
  /** Whether the bootstrap completed successfully */
  success: boolean;
  /** Unique ID for this bootstrap run */
  runId: string;
  /** Timestamp of completion */
  completedAt: string;
  /** Summary of all configured adapters */
  adapters: Record<BootstrapStep, AdapterStatus>;
  /** Error message if finalization failed */
  error?: string;
}

/**
 * Health status for a single adapter.
 */
export interface AdapterHealth {
  /** Whether the adapter is healthy */
  healthy: boolean;
  /** Adapter name/type */
  adapter: string;
  /** Response latency in milliseconds */
  latencyMs: number;
  /** Human-readable status message */
  message: string;
  /** Timestamp of the health check */
  checkedAt: string;
}

/**
 * Aggregated health check result for all adapters.
 */
export interface AggregatedHealth {
  /** Overall system health */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Individual adapter health results */
  adapters: Record<string, AdapterHealth>;
  /** Timestamp of the aggregated check */
  checkedAt: string;
}

// ─── Bootstrap Run Record ────────────────────────────────────────────────────

/**
 * Record of a bootstrap run stored in the database.
 */
export interface BootstrapRunRecord {
  id: string;
  status: 'in_progress' | 'completed' | 'failed';
  completedSteps: BootstrapStep[];
  adapterConfigs: Record<BootstrapStep, unknown>;
  startedAt: string;
  completedAt?: string;
  error?: string;
}

// ─── Service Interface ───────────────────────────────────────────────────────

/**
 * The Install Service interface as defined in the design document.
 */
export interface InstallService {
  getBootstrapStatus(): Promise<BootstrapStatus>;
  configureCDN(config: CdnConfigInput): Promise<ValidationResult>;
  configureDatabase(config: DatabaseConfigInput): Promise<ValidationResult>;
  configureStorage(config: StorageConfigInput): Promise<ValidationResult>;
  configureCache(config: CacheConfigInput): Promise<ValidationResult>;
  configureQueue(config: QueueConfigInput): Promise<ValidationResult>;
  finalizeBootstrap(): Promise<BootstrapResult>;
  getAdapterHealth(): Promise<AggregatedHealth>;
}
