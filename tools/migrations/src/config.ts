/**
 * Migration configuration loader.
 * Reads from environment variables (via .env file or process.env).
 */

import { MigrationConfig } from './types.js';

export function loadConfig(): MigrationConfig {
  return {
    mysql: {
      host: env('LEGACY_MYSQL_HOST', 'localhost'),
      port: parseInt(env('LEGACY_MYSQL_PORT', '3306'), 10),
      database: env('LEGACY_MYSQL_DATABASE', 'proctira_core'),
      user: env('LEGACY_MYSQL_USER', 'root'),
      password: env('LEGACY_MYSQL_PASSWORD', ''),
    },
    pg: {
      host: env('TARGET_PG_HOST', 'localhost'),
      port: parseInt(env('TARGET_PG_PORT', '5432'), 10),
      database: env('TARGET_PG_DATABASE', 'proctira_unified'),
      user: env('TARGET_PG_USER', 'postgres'),
      password: env('TARGET_PG_PASSWORD', ''),
      schema: env('TARGET_PG_SCHEMA', 'public'),
    },
    batchSize: parseInt(env('MIGRATION_BATCH_SIZE', '5000'), 10),
    defaultTenantName: env('MIGRATION_DEFAULT_TENANT_NAME', 'Default Organization'),
    defaultTenantSlug: env('MIGRATION_DEFAULT_TENANT_SLUG', 'default'),
    stagingSchema: env('MIGRATION_STAGING_SCHEMA', 'migration_staging'),
    logLevel: env('MIGRATION_LOG_LEVEL', 'info') as MigrationConfig['logLevel'],
    pgloaderBin: env('PGLOADER_BIN', 'pgloader'),
  };
}

function env(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}
