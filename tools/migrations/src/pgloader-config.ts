/**
 * Generates a pgloader configuration file from environment settings.
 *
 * pgloader handles the bulk MySQL → PostgreSQL data transfer into a staging schema.
 * This script generates the .load file with actual connection credentials substituted.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { loadConfig } from './config.js';
import { MigrationConfig, MigrationStepResult } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(__dirname, '../pgloader/proctira-migration.load');
const OUTPUT_PATH = resolve(__dirname, '../pgloader/generated-migration.load');

/**
 * Generates the pgloader config file with credentials substituted.
 */
export function generatePgloaderConfig(config: MigrationConfig): string {
  const template = readFileSync(TEMPLATE_PATH, 'utf-8');

  const output = template
    .replace(/\{\{MYSQL_USER\}\}/g, config.mysql.user)
    .replace(/\{\{MYSQL_PASSWORD\}\}/g, config.mysql.password)
    .replace(/\{\{MYSQL_HOST\}\}/g, config.mysql.host)
    .replace(/\{\{MYSQL_PORT\}\}/g, String(config.mysql.port))
    .replace(/\{\{MYSQL_DATABASE\}\}/g, config.mysql.database)
    .replace(/\{\{PG_USER\}\}/g, config.pg.user)
    .replace(/\{\{PG_PASSWORD\}\}/g, config.pg.password)
    .replace(/\{\{PG_HOST\}\}/g, config.pg.host)
    .replace(/\{\{PG_PORT\}\}/g, String(config.pg.port))
    .replace(/\{\{PG_DATABASE\}\}/g, config.pg.database);

  writeFileSync(OUTPUT_PATH, output, 'utf-8');
  return OUTPUT_PATH;
}

/**
 * Runs pgloader with the generated configuration.
 */
export function runPgloader(config: MigrationConfig): MigrationStepResult {
  const startTime = Date.now();
  const errors: MigrationStepResult['errors'] = [];
  const warnings: MigrationStepResult['warnings'] = [];

  try {
    const configPath = generatePgloaderConfig(config);

    console.log(`[pgloader] Running bulk transfer: MySQL → PostgreSQL`);
    console.log(`[pgloader] Source: ${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`);
    console.log(`[pgloader] Target: ${config.pg.host}:${config.pg.port}/${config.pg.database}`);
    console.log(`[pgloader] Staging schema: ${config.stagingSchema}`);

    const output = execSync(`${config.pgloaderBin} ${configPath}`, {
      encoding: 'utf-8',
      timeout: 600_000, // 10 minute timeout for large databases
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse pgloader output for table counts
    const tableMatches = output.match(/(\d+) tables? created/);
    const rowMatches = output.match(/(\d+) rows? imported/);
    const tablesProcessed = tableMatches?.[1] ? parseInt(tableMatches[1], 10) : 0;
    const rowsProcessed = rowMatches?.[1] ? parseInt(rowMatches[1], 10) : 0;

    // Check for warnings in output
    const warningLines = output.split('\n').filter((l) => l.includes('WARNING'));
    for (const line of warningLines) {
      warnings.push({ table: 'unknown', message: line.trim() });
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
  }
}
