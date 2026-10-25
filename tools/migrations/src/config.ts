/**
 * Migration configuration loader.
 * Reads from environment variables (via .env file or process.env).
 *
 * PRC-L376: credentials are never defaulted. Users and passwords must be
 * supplied (an empty password is accepted only outside production with
 * MIGRATION_ALLOW_EMPTY_PASSWORD=1 for local throwaway databases). Target
 * Postgres TLS is controlled by TARGET_PG_SSL and defaults to verified TLS in
 * production. Schema names and the batch size are interpolated into SQL, so
 * TARGET_PG_SCHEMA / MIGRATION_STAGING_SCHEMA must be safe identifiers and
 * MIGRATION_BATCH_SIZE a positive integer.
 *
 * The migrator connects as a dedicated owner role (not the runtime
 * proctira_app role): it owns the migrated objects and deliberately bypasses
 * RLS while backfilling tenant_id, so it must never be reused by application
 * pods.
 */

import { assertSafeIdentifier } from './sql-safety.js';
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

  // These values are spliced into SQL as quoted identifiers / LIMIT across the
  // pipeline, so validate them once here and fail closed.
  const pgSchema = env('TARGET_PG_SCHEMA', 'public');
  assertSafeIdentifier(pgSchema, 'TARGET_PG_SCHEMA');
  const stagingSchema = env('MIGRATION_STAGING_SCHEMA', 'migration_staging');
  assertSafeIdentifier(stagingSchema, 'MIGRATION_STAGING_SCHEMA');
  const batchSizeRaw = env('MIGRATION_BATCH_SIZE', '5000');
  if (!/^[1-9][0-9]*$/.test(batchSizeRaw)) {
    throw new Error(
      `MIGRATION_BATCH_SIZE must be a positive integer: ${JSON.stringify(batchSizeRaw)}`,
    );
  }

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
      schema: pgSchema,
    },
    batchSize: parseInt(batchSizeRaw, 10),
    defaultTenantName: env('MIGRATION_DEFAULT_TENANT_NAME', 'Default Organization'),
    defaultTenantSlug: env('MIGRATION_DEFAULT_TENANT_SLUG', 'default'),
    stagingSchema,
    logLevel: env('MIGRATION_LOG_LEVEL', 'info') as MigrationConfig['logLevel'],
    pgloaderBin: env('PGLOADER_BIN', 'pgloader'),
    reportOutputPath: process.env['MIGRATION_REPORT_OUTPUT_PATH'] || undefined,
  };
}
