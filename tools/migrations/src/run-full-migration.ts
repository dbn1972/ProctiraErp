/**
 * Full migration pipeline orchestrator.
 *
 * Runs all migration steps in sequence:
 * 1. pgloader bulk transfer (MySQL → PostgreSQL staging)
 * 2. Schema transformation (staging → target with column mapping)
 * 3. UUID generation (integer PKs → UUIDs with FK remapping)
 * 4. Tenant assignment (all data → default tenant)
 * 5. Validation (row counts, integrity, UUID format)
 *
 * Each step produces a MigrationStepResult. The pipeline halts on critical
 * errors but continues through warnings.
 */

import 'dotenv/config';
import { loadConfig } from './config.js';
import { runPgloader } from './pgloader-config.js';
import { transformSchema } from './transform-schema.js';
import { generateUuids } from './generate-uuids.js';
import { assignTenant } from './assign-tenant.js';
import { validateMigration } from './validate-migration.js';
import { MigrationStepResult } from './types.js';

interface MigrationReport {
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  steps: MigrationStepResult[];
  overallStatus: 'success' | 'warning' | 'error';
}

async function runFullMigration(): Promise<MigrationReport> {
  const config = loadConfig();
  const steps: MigrationStepResult[] = [];
  const startedAt = new Date().toISOString();
  const startTime = Date.now();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║       ProctiraERP Legacy → Unified Platform Migration          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Source: MySQL ${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`);
  console.log(`Target: PostgreSQL ${config.pg.host}:${config.pg.port}/${config.pg.database}`);
  console.log(`Tenant: ${config.defaultTenantName} (${config.defaultTenantSlug})`);
  console.log('');

  // Step 1: pgloader bulk transfer
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 1/5: Bulk Data Transfer (pgloader)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const pgloaderResult = await runPgloader(config);
  steps.push(pgloaderResult);
  logStepResult(pgloaderResult);

  if (pgloaderResult.status === 'error') {
    console.error('\n✗ pgloader failed. Cannot continue migration.');
    return buildReport(startedAt, startTime, steps);
  }

  // Step 2: Schema transformation
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 2/5: Schema Transformation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const transformResult = await transformSchema(config);
  steps.push(transformResult);
  logStepResult(transformResult);

  if (transformResult.status === 'error') {
    console.error('\n✗ Schema transformation failed. Cannot continue migration.');
    return buildReport(startedAt, startTime, steps);
  }

  // Step 3: UUID generation
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 3/5: UUID Generation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const uuidResult = await generateUuids(config);
  steps.push(uuidResult);
  logStepResult(uuidResult);

  if (uuidResult.status === 'error') {
    console.error('\n✗ UUID generation failed. Cannot continue migration.');
    return buildReport(startedAt, startTime, steps);
  }

  // Step 4: Tenant assignment
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 4/5: Tenant Assignment');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const tenantResult = await assignTenant(config);
  steps.push(tenantResult);
  logStepResult(tenantResult);

  if (tenantResult.status === 'error') {
    console.error('\n✗ Tenant assignment failed. Cannot continue migration.');
    return buildReport(startedAt, startTime, steps);
  }

  // Step 5: Validation
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Step 5/5: Post-Migration Validation');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const validationResult = await validateMigration(config);
  steps.push(validationResult);
  logStepResult(validationResult);

  const report = buildReport(startedAt, startTime, steps);

  // Final summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  Migration ${report.overallStatus.toUpperCase().padEnd(8)} | Duration: ${formatDuration(report.totalDurationMs).padEnd(20)} ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (report.overallStatus === 'success') {
    console.log('\n✓ Migration completed successfully!');
    console.log('  Next steps:');
    console.log('  1. Review the validation report above');
    console.log('  2. Run application-level smoke tests');
    console.log('  3. Drop the migration_staging schema when satisfied');
  } else if (report.overallStatus === 'warning') {
    console.log('\n⚠ Migration completed with warnings. Review the report above.');
  } else {
    console.log('\n✗ Migration failed. Review errors above and retry.');
  }

  return report;
}

function buildReport(
  startedAt: string,
  startTime: number,
  steps: MigrationStepResult[]
): MigrationReport {
  const hasError = steps.some((s) => s.status === 'error');
  const hasWarning = steps.some((s) => s.status === 'warning');

  return {
    startedAt,
    completedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - startTime,
    steps,
    overallStatus: hasError ? 'error' : hasWarning ? 'warning' : 'success',
  };
}

function logStepResult(result: MigrationStepResult): void {
  const icon = result.status === 'success' ? '✓' : result.status === 'warning' ? '⚠' : '✗';
  console.log(`\n${icon} ${result.step}: ${result.status} (${formatDuration(result.durationMs)})`);
  console.log(`  Tables: ${result.tablesProcessed} | Rows: ${result.rowsProcessed}`);
  if (result.errors.length > 0) {
    console.log(`  Errors: ${result.errors.length}`);
  }
  if (result.warnings.length > 0) {
    console.log(`  Warnings: ${result.warnings.length}`);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

// Run if executed directly
runFullMigration().catch((error) => {
  console.error('Fatal migration error:', error);
  process.exit(1);
});
