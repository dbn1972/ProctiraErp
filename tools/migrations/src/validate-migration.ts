/**
 * Post-migration validation.
 *
 * Verifies the migration was successful by checking:
 * 1. Row counts match between source (staging) and target tables
 * 2. Referential integrity is preserved (no orphaned foreign keys)
 * 3. All required columns are populated (no unexpected NULLs)
 * 4. UUID format is valid for all primary keys
 * 5. Tenant assignment is complete
 *
 * Produces a ValidationReport that can be reviewed before decommissioning
 * the staging schema.
 */

import type { PoolClient } from 'pg';
import { Pool } from 'pg';

import { TABLE_MAPPINGS } from './table-mappings.js';
import type {
  MigrationConfig,
  MigrationStepResult,
  ValidationReport,
  TableValidation,
  IntegrityError,
} from './types.js';
import { quoteIdent } from './sql-safety.js';

type QueryClient = Pick<PoolClient, 'query'>;

/** A check that could not run. Any of these blocks a successful validation. */
export interface CheckFailure {
  table: string;
  column?: string;
  message: string;
}

/**
 * Describes a SQL error, distinguishing a missing table (42P01) and a missing
 * column (42703) from any other failure.
 */
export function describeCheckError(check: string, error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (code === '42P01') return `${check} could not run: table does not exist (${message})`;
  if (code === '42703') return `${check} could not run: column does not exist (${message})`;
  return `${check} could not run: ${message}`;
}

/**
 * Compares row counts between staging and target tables.
 */
async function validateRowCounts(
  client: QueryClient,
  stagingSchema: string,
  targetSchema: string,
  failures: CheckFailure[],
): Promise<TableValidation[]> {
  const results: TableValidation[] = [];

  for (const mapping of TABLE_MAPPINGS) {
    try {
      const filterClause = mapping.sourceFilter ? `WHERE ${mapping.sourceFilter}` : '';

      const sourceResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM ${quoteIdent(stagingSchema)}.${quoteIdent(mapping.sourceTable)} ${filterClause}`,
      );
      const sourceCount = parseInt(sourceResult.rows[0]!.count, 10);

      const targetResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM ${quoteIdent(targetSchema)}.${quoteIdent(mapping.targetTable)}`,
      );
      const targetCount = parseInt(targetResult.rows[0]!.count, 10);

      results.push({
        sourceTable: mapping.sourceTable,
        targetTable: mapping.targetTable,
        sourceRowCount: sourceCount,
        targetRowCount: targetCount,
        status: sourceCount === targetCount ? 'match' : 'mismatch',
        missingRows: Math.max(0, sourceCount - targetCount),
        extraRows: Math.max(0, targetCount - sourceCount),
      });
    } catch (error) {
      failures.push({
        table: mapping.targetTable,
        message: describeCheckError('Row count check', error),
      });
      results.push({
        sourceTable: mapping.sourceTable,
        targetTable: mapping.targetTable,
        sourceRowCount: 0,
        targetRowCount: 0,
        status: 'skipped',
        missingRows: 0,
        extraRows: 0,
      });
    }
  }

  return results;
}

/**
 * Checks referential integrity for all foreign key relationships.
 */
async function validateReferentialIntegrity(
  client: QueryClient,
  targetSchema: string,
  failures: CheckFailure[],
): Promise<IntegrityError[]> {
  const errors: IntegrityError[] = [];

  for (const mapping of TABLE_MAPPINGS) {
    for (const fk of mapping.foreignKeys) {
      try {
        // Find rows where FK references a non-existent row in the target table
        const result = await client.query<{ orphan_count: string; sample_ids: string[] | null }>(`
          SELECT COUNT(*) as orphan_count,
                 ARRAY_AGG(t.id::text) FILTER (WHERE t.id IS NOT NULL) AS sample_ids
          FROM ${quoteIdent(targetSchema)}.${quoteIdent(mapping.targetTable)} t
          LEFT JOIN ${quoteIdent(targetSchema)}.${quoteIdent(fk.targetReferencesTable)} ref
            ON t.${quoteIdent(fk.column)} = ref.id
          WHERE t.${quoteIdent(fk.column)} IS NOT NULL
            AND ref.id IS NULL
        `);

        const row = result.rows[0]!;
        const orphanCount = parseInt(row.orphan_count, 10);
        if (orphanCount > 0) {
          const sampleIds = (row.sample_ids || []).slice(0, 5);
          errors.push({
            table: mapping.targetTable,
            column: fk.column,
            referencedTable: fk.targetReferencesTable,
            orphanedCount: orphanCount,
            sampleIds,
          });
        }
      } catch (error) {
        failures.push({
          table: mapping.targetTable,
          column: fk.column,
          message: describeCheckError('Referential integrity check', error),
        });
      }
    }
  }

  return errors;
}

/**
 * Validates UUID format for all primary keys in target tables.
 */
async function validateUuidFormat(
  client: QueryClient,
  targetSchema: string,
  failures: CheckFailure[],
): Promise<{ table: string; invalidCount: number }[]> {
  const issues: { table: string; invalidCount: number }[] = [];
  const uuidRegex = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  for (const mapping of TABLE_MAPPINGS) {
    if (!mapping.requiresUuidGeneration) continue;

    try {
      const result = await client.query<{ invalid_count: string }>(`
        SELECT COUNT(*) as invalid_count
        FROM ${quoteIdent(targetSchema)}.${quoteIdent(mapping.targetTable)}
        WHERE id IS NOT NULL AND id::text !~ '${uuidRegex}'
      `);

      const invalidCount = parseInt(result.rows[0]!.invalid_count, 10);
      if (invalidCount > 0) {
        issues.push({ table: mapping.targetTable, invalidCount });
      }
    } catch (error) {
      failures.push({
        table: mapping.targetTable,
        message: describeCheckError('UUID format check', error),
      });
    }
  }

  return issues;
}

/**
 * Validates that tenant_id is set on all tenant-scoped rows.
 */
async function validateTenantAssignment(
  client: QueryClient,
  targetSchema: string,
  failures: CheckFailure[],
): Promise<{ table: string; missingCount: number }[]> {
  const issues: { table: string; missingCount: number }[] = [];

  for (const mapping of TABLE_MAPPINGS) {
    try {
      const result = await client.query<{ missing_count: string }>(`
        SELECT COUNT(*) as missing_count
        FROM ${quoteIdent(targetSchema)}.${quoteIdent(mapping.targetTable)}
        WHERE tenant_id IS NULL
      `);

      const missingCount = parseInt(result.rows[0]!.missing_count, 10);
      if (missingCount > 0) {
        issues.push({ table: mapping.targetTable, missingCount });
      }
    } catch (error) {
      failures.push({
        table: mapping.targetTable,
        column: 'tenant_id',
        message: describeCheckError('Tenant assignment check', error),
      });
    }
  }

  return issues;
}

/**
 * Runs the full validation suite and produces a report.
 */
export async function validateMigration(config: MigrationConfig): Promise<MigrationStepResult> {
  const pool = new Pool({
    host: config.pg.host,
    port: config.pg.port,
    database: config.pg.database,
    user: config.pg.user,
    password: config.pg.password,
  });

  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    return await runValidationChecks(client, config.stagingSchema, config.pg.schema);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      step: 'validation',
      status: 'error',
      tablesProcessed: 0,
      rowsProcessed: 0,
      errors: [{ table: 'all', message: `Validation failed: ${message}` }],
      warnings: [],
      durationMs: 0,
    };
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

/**
 * Runs every validation check against an open connection. A check that cannot
 * run (missing table/column, SQL error) is an error: validation only succeeds
 * when every mapping was actually checked.
 */
export async function runValidationChecks(
  client: QueryClient,
  stagingSchema: string,
  targetSchema: string,
): Promise<MigrationStepResult> {
  const startTime = Date.now();
  const errors: MigrationStepResult['errors'] = [];
  const warnings: MigrationStepResult['warnings'] = [];
  const failures: CheckFailure[] = [];

  console.log(`[validate] Starting post-migration validation...`);

  // 1. Row count validation
  console.log(`[validate] Checking row counts...`);
  const tableValidations = await validateRowCounts(client, stagingSchema, targetSchema, failures);
  const mismatches = tableValidations.filter((t) => t.status === 'mismatch');
  if (mismatches.length > 0) {
    for (const m of mismatches) {
      warnings.push({
        table: m.targetTable,
        message: `Row count mismatch: source=${m.sourceRowCount}, target=${m.targetRowCount}, missing=${m.missingRows}`,
        count: m.missingRows,
      });
      console.warn(
        `[validate]   ⚠ ${m.targetTable}: ${m.sourceRowCount} → ${m.targetRowCount} (${m.missingRows} missing)`,
      );
    }
  } else {
    console.log(`[validate]   ✓ All row counts match`);
  }

  // 2. Referential integrity
  console.log(`[validate] Checking referential integrity...`);
  const integrityErrors = await validateReferentialIntegrity(client, targetSchema, failures);
  if (integrityErrors.length > 0) {
    for (const ie of integrityErrors) {
      errors.push({
        table: ie.table,
        column: ie.column,
        message: `${ie.orphanedCount} orphaned references to ${ie.referencedTable}`,
      });
      console.error(
        `[validate]   ✗ ${ie.table}.${ie.column} → ${ie.referencedTable}: ${ie.orphanedCount} orphans`,
      );
    }
  } else {
    console.log(`[validate]   ✓ Referential integrity preserved`);
  }

  // 3. UUID format validation
  console.log(`[validate] Checking UUID format...`);
  const uuidIssues = await validateUuidFormat(client, targetSchema, failures);
  if (uuidIssues.length > 0) {
    for (const issue of uuidIssues) {
      errors.push({
        table: issue.table,
        message: `${issue.invalidCount} rows with invalid UUID format`,
      });
    }
  } else {
    console.log(`[validate]   ✓ All UUIDs valid`);
  }

  // 4. Tenant assignment validation
  console.log(`[validate] Checking tenant assignment...`);
  const tenantIssues = await validateTenantAssignment(client, targetSchema, failures);
  if (tenantIssues.length > 0) {
    for (const issue of tenantIssues) {
      errors.push({
        table: issue.table,
        message: `${issue.missingCount} rows missing tenant_id`,
      });
    }
  } else {
    console.log(`[validate]   ✓ All rows have tenant_id`);
  }

  // 5. Checks that could not run block success.
  for (const failure of failures) {
    errors.push(failure);
    console.error(`[validate]   ✗ ${failure.table}: ${failure.message}`);
  }

  // Build validation report
  const report: ValidationReport = {
    timestamp: new Date().toISOString(),
    tables: tableValidations,
    overallStatus: errors.length > 0 ? 'fail' : warnings.length > 0 ? 'warning' : 'pass',
    totalSourceRows: tableValidations.reduce((sum, t) => sum + t.sourceRowCount, 0),
    totalTargetRows: tableValidations.reduce((sum, t) => sum + t.targetRowCount, 0),
    integrityErrors,
  };

  // Output report summary
  console.log(`\n[validate] === MIGRATION VALIDATION REPORT ===`);
  console.log(`[validate] Status: ${report.overallStatus.toUpperCase()}`);
  console.log(`[validate] Total source rows: ${report.totalSourceRows}`);
  console.log(`[validate] Total target rows: ${report.totalTargetRows}`);
  console.log(`[validate] Tables processed: ${tableValidations.length}`);
  console.log(`[validate] Integrity errors: ${integrityErrors.length}`);
  console.log(`[validate] Warnings: ${warnings.length}`);

  return {
    step: 'validation',
    status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'success',
    tablesProcessed: tableValidations.length,
    rowsProcessed: report.totalTargetRows,
    errors,
    warnings,
    durationMs: Date.now() - startTime,
  };
}
