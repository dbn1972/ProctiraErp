/**
 * Migration configuration loader.
 * Reads from environment variables (via .env file or process.env).
 *
 * PRC-L376: credentials are never defaulted. Users and passwords must be
 * supplied (an empty password is accepted only outside production with
 * MIGRATION_ALLOW_EMPTY_PASSWORD=1 for local throwaway databases). Target
 * Postgres TLS is controlled by TARGET_PG_SSL and defaults to verified TLS in
 * production.
 *
 * The migrator connects as a dedicated owner role (not the runtime
 * proctira_app role): it owns the migrated objects and deliberately bypasses
 * RLS while backfilling tenant_id, so it must never be reused by application
 * pods.
 */

import type { MigrationConfig } from './types.js';

/** TARGET_PG_SSL values mapped onto node-pg's PGSSLMODE handling. */
const PG_SSL_MODES = new Set(['disable', 'require', 'verify-full']);

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): MigrationConfig {
  const production = environment.NODE_ENV === 'production';
  const allowEmptyPassword = !production && environment.MIGRATION_ALLOW_EMPTY_PASSWORD === '1';
  const env = (key: string, defaultValue: string): string => environment[key] ?? defaultValue;
  const required = (key: string): string => {
    const value = environment[key];
    if (value === undefined || value.trim() === '') {
      throw new Error(`${key} is required (migration credentials are never defaulted)`);
    }
    return value;
  };
  const password = (key: string): string => {
    const value = environment[key];
    if (value === undefined || value === '') {
      if (allowEmptyPassword) return '';
      throw new Error(
        `${key} is required${production ? ' in production' : ' (set MIGRATION_ALLOW_EMPTY_PASSWORD=1 for a local throwaway database)'}`,
      );
    }
    return value;
  };

  const pgSsl = env('TARGET_PG_SSL', production ? 'verify-full' : 'disable');
  if (!PG_SSL_MODES.has(pgSsl)) {
    throw new Error(`TARGET_PG_SSL must be one of ${[...PG_SSL_MODES].join(', ')}`);
  }
  if (production && pgSsl === 'disable' && environment.MIGRATION_ALLOW_INSECURE_PG !== '1') {
    throw new Error('TARGET_PG_SSL=disable in production requires MIGRATION_ALLOW_INSECURE_PG=1');
  }
  // Every Pool in this package is built without an explicit `ssl`, so node-pg
  // resolves TLS from PGSSLMODE. An operator-set PGSSLMODE still wins.
  if (environment.PGSSLMODE === undefined) {
    environment.PGSSLMODE = pgSsl;
  }

  return {
    mysql: {
      host: env('LEGACY_MYSQL_HOST', 'localhost'),
      port: parseInt(env('LEGACY_MYSQL_PORT', '3306'), 10),
      database: env('LEGACY_MYSQL_DATABASE', 'proctira_core'),
      user: required('LEGACY_MYSQL_USER'),
      password: password('LEGACY_MYSQL_PASSWORD'),
    },
    pg: {
      host: env('TARGET_PG_HOST', 'localhost'),
      port: parseInt(env('TARGET_PG_PORT', '5432'), 10),
      database: env('TARGET_PG_DATABASE', 'proctira_unified'),
      user: required('TARGET_PG_USER'),
      password: password('TARGET_PG_PASSWORD'),
      schema: env('TARGET_PG_SCHEMA', 'public'),
    },
    batchSize: parseInt(env('MIGRATION_BATCH_SIZE', '5000'), 10),
    defaultTenantName: env('MIGRATION_DEFAULT_TENANT_NAME', 'Default Organization'),
    defaultTenantSlug: env('MIGRATION_DEFAULT_TENANT_SLUG', 'default'),
    stagingSchema: env('MIGRATION_STAGING_SCHEMA', 'migration_staging'),
    logLevel: env('MIGRATION_LOG_LEVEL', 'info') as MigrationConfig['logLevel'],
    pgloaderBin: env('PGLOADER_BIN', 'pgloader'),
    reportOutputPath: process.env['MIGRATION_REPORT_OUTPUT_PATH'] || undefined,
  };
}
