/**
 * Generates a pgloader configuration file from environment settings.
 *
 * pgloader handles the bulk MySQL → PostgreSQL data transfer into a staging schema.
 * This script generates the .load file with actual connection credentials substituted.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { execPgloader, parsePgloaderSummary } from './pgloader-exec.js';
import type { MigrationConfig, MigrationStepResult } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// PRC-H104: the shipped template is openemis-migration.load (proctira-migration.load never existed).
export const TEMPLATE_PATH = resolve(__dirname, '../pgloader/openemis-migration.load');

/**
 * Generates the pgloader config file with credentials substituted.
 */
const SCHEMA_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * PRC-H104: writes the generated config (it contains plaintext DB credentials) to a private temp
 * directory with mode 0600 — never into the source tree. Credentials are URL-encoded so '@', ':'
 * or '/' in a password cannot break the connection URLs. Callers remove it with
 * removeGeneratedPgloaderConfig once pgloader has run.
 */
export function generatePgloaderConfig(config: MigrationConfig): string {
  const schema = config.stagingSchema ?? 'migration_staging';
  if (!SCHEMA_RE.test(schema)) {
    throw new Error(`Invalid staging schema name: ${schema}`);
  }
  const enc = encodeURIComponent;
  const template = readFileSync(TEMPLATE_PATH, 'utf-8');
  const output = template
    .replace(/\{\{MYSQL_USER\}\}/g, enc(config.mysql.user))
    .replace(/\{\{MYSQL_PASSWORD\}\}/g, enc(config.mysql.password))
    .replace(/\{\{MYSQL_HOST\}\}/g, config.mysql.host)
    .replace(/\{\{MYSQL_PORT\}\}/g, String(config.mysql.port))
    .replace(/\{\{MYSQL_DATABASE\}\}/g, enc(config.mysql.database))
    // PRC-L376: TLS to the legacy source; `useSSL` is pgloader's MySQL connection option.
    .replace(/\{\{MYSQL_PARAMS\}\}/g, config.mysql.ssl ? '?useSSL=true' : '?useSSL=false')
    .replace(/\{\{PG_USER\}\}/g, enc(config.pg.user))
    .replace(/\{\{PG_PASSWORD\}\}/g, enc(config.pg.password))
    .replace(/\{\{PG_HOST\}\}/g, config.pg.host)
    .replace(/\{\{PG_PORT\}\}/g, String(config.pg.port))
    .replace(/\{\{PG_DATABASE\}\}/g, enc(config.pg.database))
    .replace(/migration_staging/g, schema);
  const dir = mkdtempSync(join(tmpdir(), 'proctira-pgloader-'));
  const outputPath = join(dir, 'generated-migration.load');
  writeFileSync(outputPath, output, { encoding: 'utf-8', mode: 0o600 });
  return outputPath;
}

/** Delete a config written by generatePgloaderConfig (and its private temp directory). */
export function removeGeneratedPgloaderConfig(path: string): void {
  rmSync(dirname(path), { recursive: true, force: true });
}

/**
 * Runs pgloader with the generated configuration.
 */
export function runPgloader(config: MigrationConfig): MigrationStepResult {
  const startTime = Date.now();
  const errors: MigrationStepResult['errors'] = [];
  const warnings: MigrationStepResult['warnings'] = [];
  let configPath: string | null = null;

  try {
    configPath = generatePgloaderConfig(config);

    console.log(`[pgloader] Running bulk transfer: MySQL → PostgreSQL`);
    console.log(
      `[pgloader] Source: ${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`,
    );
    console.log(`[pgloader] Target: ${config.pg.host}:${config.pg.port}/${config.pg.database}`);
    console.log(`[pgloader] Staging schema: ${config.stagingSchema}`);

    // PRC-L377: no shell — PGLOADER_BIN is a program path, the config path an argv entry.
    const output = execPgloader(config.pgloaderBin, configPath);
    const summary = parsePgloaderSummary(output);

    // Parse pgloader output for table counts
    const tableMatches = output.match(/(\d+) tables? created/);
    const tablesProcessed = tableMatches?.[1] ? parseInt(tableMatches[1], 10) : summary.entries;
    const rowsProcessed = summary.rowsImported;

    // Check for warnings in output
    const warningLines = output.split('\n').filter((l) => l.includes('WARNING'));
    for (const line of warningLines) {
      warnings.push({ table: 'unknown', message: line.trim() });
    }

    // Rejected rows show up only in the summary `errors` column; never call that success.
    if (!summary.parsed) {
      errors.push({ table: 'all', message: 'pgloader summary not found in output' });
    }
    for (const entry of summary.failedEntries) {
      errors.push({ table: entry.name, message: `pgloader reported ${entry.errors} error(s)` });
    }
    if (errors.length > 0) {
      return {
        step: 'pgloader-bulk-transfer',
        status: 'error',
        tablesProcessed,
        rowsProcessed,
        errors,
        warnings,
        durationMs: Date.now() - startTime,
      };
    }

    return {
      step: 'pgloader-bulk-transfer',
      status: warnings.length > 0 ? 'warning' : 'success',
      tablesProcessed,
      rowsProcessed,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ table: 'all', message: `pgloader failed: ${message}` });

    return {
      step: 'pgloader-bulk-transfer',
      status: 'error',
      tablesProcessed: 0,
      rowsProcessed: 0,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } finally {
    // The generated file holds plaintext credentials; never leave it behind.
    if (configPath) removeGeneratedPgloaderConfig(configPath);
  }
}
