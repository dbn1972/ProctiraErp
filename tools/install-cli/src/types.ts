/**
 * Types for the Install CLI tool.
 *
 * Defines the configuration file schema, CLI options,
 * and admin account creation types.
 */

import type {
  CdnConfigInput,
  DatabaseConfigInput,
  StorageConfigInput,
  CacheConfigInput,
  QueueConfigInput,
} from '@proctira/backend-install';

/**
 * Configuration source mode for the CLI.
 */
export type ConfigSource = 'file' | 'env' | 'interactive';

/**
 * CLI command-line options parsed from argv.
 */
export interface CliOptions {
  /** Path to JSON configuration file */
  configFile?: string;
  /** Use environment variables for configuration */
  useEnv?: boolean;
  /** Run in interactive mode (prompts) */
  interactive?: boolean;
  /** Skip database migration step */
  skipMigrations?: boolean;
  /** Skip admin account creation */
  skipAdmin?: boolean;
  /** Output format: text or json */
  outputFormat?: 'text' | 'json';
  /** Verbose logging */
  verbose?: boolean;
  /** Show help */
  help?: boolean;
  /** Show version */
  version?: boolean;
}

/**
 * Admin account configuration for initial platform setup.
 */
export interface AdminAccountConfig {
  /** Admin username (email) */
  username: string;
  /** Admin password (min 8 chars) */
  password: string;
  /** Admin first name */
  firstName: string;
  /** Admin last name */
  lastName: string;
}

/**
 * Full installation configuration file schema.
 * This is the JSON file format accepted by --config flag.
 */
export interface InstallConfig {
  /** CDN adapter configuration */
  cdn: CdnConfigInput;
  /** Database adapter configuration */
  database: DatabaseConfigInput;
  /** Object storage adapter configuration */
  storage: StorageConfigInput;
  /** Cache adapter configuration */
  cache: CacheConfigInput;
  /** Queue adapter configuration */
  queue: QueueConfigInput;
  /** Initial admin account */
  admin: AdminAccountConfig;
}

/**
 * Environment variable mapping for configuration.
 * Maps env var names to their config paths.
 */
export const ENV_VAR_MAP = {
  // CDN
  OPENEMIS_CDN_ADAPTER: 'cdn.adapter',
  OPENEMIS_CDN_BASE_URL: 'cdn.baseUrl',
  OPENEMIS_CDN_TENANT_AWARE: 'cdn.tenantAware',
  OPENEMIS_CDN_CLOUDFRONT_DISTRIBUTION_ID: 'cdn.cloudfront.distributionId',
  OPENEMIS_CDN_CLOUDFRONT_REGION: 'cdn.cloudfront.region',

  // Database
  OPENEMIS_DB_PROVIDER: 'database.provider',
  OPENEMIS_DB_HOST: 'database.host',
  OPENEMIS_DB_PORT: 'database.port',
  OPENEMIS_DB_NAME: 'database.database',
  OPENEMIS_DB_USERNAME: 'database.username',
  OPENEMIS_DB_PASSWORD: 'database.password',
  OPENEMIS_DB_SSL: 'database.ssl',
  OPENEMIS_DB_POOL_SIZE: 'database.poolSize',

  // Storage
  OPENEMIS_STORAGE_ADAPTER: 'storage.adapter',
  OPENEMIS_STORAGE_BUCKET: 'storage.bucket',
  OPENEMIS_STORAGE_REGION: 'storage.region',
  OPENEMIS_STORAGE_ENDPOINT: 'storage.endpoint',
  OPENEMIS_STORAGE_ACCESS_KEY: 'storage.accessKeyId',
  OPENEMIS_STORAGE_SECRET_KEY: 'storage.secretAccessKey',
  OPENEMIS_STORAGE_FORCE_PATH_STYLE: 'storage.forcePathStyle',

  // Cache
  OPENEMIS_CACHE_ADAPTER: 'cache.adapter',
  OPENEMIS_CACHE_HOST: 'cache.host',
  OPENEMIS_CACHE_PORT: 'cache.port',
  OPENEMIS_CACHE_PASSWORD: 'cache.password',
  OPENEMIS_CACHE_DB: 'cache.db',
  OPENEMIS_CACHE_TLS: 'cache.tls',
  OPENEMIS_CACHE_KEY_PREFIX: 'cache.keyPrefix',

  // Queue
  OPENEMIS_QUEUE_BACKEND: 'queue.backend',
  OPENEMIS_QUEUE_KAFKA_BROKERS: 'queue.kafka.brokers',
  OPENEMIS_QUEUE_KAFKA_CLIENT_ID: 'queue.kafka.clientId',
  OPENEMIS_QUEUE_KAFKA_GROUP_ID: 'queue.kafka.groupId',
  OPENEMIS_QUEUE_RABBITMQ_URL: 'queue.rabbitmq.url',
  OPENEMIS_QUEUE_RABBITMQ_EXCHANGE: 'queue.rabbitmq.exchange',
  OPENEMIS_QUEUE_SQS_REGION: 'queue.sqs.region',
  OPENEMIS_QUEUE_SQS_QUEUE_URL_PREFIX: 'queue.sqs.queueUrlPrefix',

  // Admin
  OPENEMIS_ADMIN_USERNAME: 'admin.username',
  OPENEMIS_ADMIN_PASSWORD: 'admin.password',
  OPENEMIS_ADMIN_FIRST_NAME: 'admin.firstName',
  OPENEMIS_ADMIN_LAST_NAME: 'admin.lastName',
} as const;

/**
 * Result of the full installation process.
 */
export interface InstallResult {
  /** Whether the installation completed successfully */
  success: boolean;
  /** Timestamp of completion */
  completedAt: string;
  /** Configuration validation results per adapter */
  adapterResults: Record<string, { success: boolean; message: string; latencyMs?: number }>;
  /** Whether migrations were run */
  migrationsRun: boolean;
  /** Whether admin account was created */
  adminCreated: boolean;
  /** Health check results */
  health: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    adapters: Record<string, { healthy: boolean; message: string }>;
  };
  /** Error message if installation failed */
  error?: string;
}
