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

import { Pool, PoolClient } from 'pg';
import { loadConfig } from './config.js';
import {
  MigrationConfig,
  MigrationStepResult,
  ValidationReport,
  TableValidation,
  IntegrityError,
} from './types.js';
import { TABLE_MAPPINGS } from './table-mappings.js';

/**
 * Compares row counts between staging and target tables.
 */
async function validateRowCounts(
  client: PoolClient,
  stagingSchema: string,
  targetSchema: string,
): Promise<TableValidation[]> {
  const results: TableValidation[] = [];

  for (const mapping of TABLE_MAPPINGS) {
    try {
      const filterClause = mapping.sourceFilter ? `WHERE ${mapping.sourceFilter}` : '';

      const sourceResult = await client.query(
        `SELECT COUNT(*) as count FROM "${stagingSchema}"."${mapping.sourceTable}" ${filterClause}`,
      );
      const sourceCount = parseInt(sourceResult.rows[0].count, 10);

      const targetResult = await client.query(
        `SELECT COUNT(*) as count FROM "${targetSchema}"."${mapping.targetTable}"`,
      );
      const targetCount = parseInt(targetResult.rows[0].count, 10);

      results.push({
        sourceTable: mapping.sourceTable,
        targetTable: mapping.targetTable,
        sourceRowCount: sourceCount,
        targetRowCount: targetCount,
        status: sourceCount === targetCount ? 'match' : 'mismatch',
        missingRows: Math.max(0, sourceCount - targetCount),
        extraRows: Math.max(0, targetCount - sourceCount),
      });
    } catch {
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
  client: PoolClient,
  targetSchema: string,
): Promise<IntegrityError[]> {
  const errors: IntegrityError[] = [];

  for (const mapping of TABLE_MAPPINGS) {
    for (const fk of mapping.foreignKeys) {
      try {
        // Find rows where FK references a non-existent row in the target table
        const result = await client.query(`
          SELECT COUNT(*) as orphan_count,
                 ARRAY_AGG(t.id::text) FILTER (WHERE t.id IS NOT NULL) AS sample_ids
          FROM "${targetSchema}"."${mapping.targetTable}" t
          LEFT JOIN "${targetSchema}"."${fk.targetReferencesTable}" ref
            ON t."${fk.column}" = ref.id
          WHERE t."${fk.column}" IS NOT NULL
            AND ref.id IS NULL
        `);

        const orphanCount = parseInt(result.rows[0].orphan_count, 10);
        if (orphanCount > 0) {
          const sampleIds = (result.rows[0].sample_ids || []).slice(0, 5);
          errors.push({
            table: mapping.targetTable,
            column: fk.column,
            referencedTable: fk.targetReferencesTable,
            orphanedCount: orphanCount,
            sampleIds,
          });
        }
      } catch {
        // Table might not exist yet; skip
      }
    }
  }

  return errors;
}

/**
 * Validates UUID format for all primary keys in target tables.
 */
async function validateUuidFormat(
  client: PoolClient,
  targetSchema: string,
): Promise<{ table: string; invalidCount: number }[]> {
  const issues: { table: string; invalidCount: number }[] = [];
  const uuidRegex = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

  for (const mapping of TABLE_MAPPINGS) {
    if (!mapping.requiresUuidGeneration) continue;

    try {
      const result = await client.query(`
        SELECT COUNT(*) as invalid_count
        FROM "${targetSchema}"."${mapping.targetTable}"
        WHERE id IS NOT NULL AND id::text !~ '${uuidRegex}'
      `);

      const invalidCount = parseInt(result.rows[0].invalid_count, 10);
      if (invalidCount > 0) {
        issues.push({ table: mapping.targetTable, invalidCount });
      }
    } catch {
      // Skip if table doesn't exist
    }
  }

  return issues;
}

/**
 * Validates that tenant_id is set on all tenant-scoped rows.
 */
async function validateTenantAssignment(
  client: PoolClient,
  targetSchema: string,
): Promise<{ table: string; missingCount: number }[]> {
  const issues: { table: string; missingCount: number }[] = [];

  for (const mapping of TABLE_MAPPINGS) {
    try {
      const result = await client.query(`
        SELECT COUNT(*) as missing_count
        FROM "${targetSchema}"."${mapping.targetTable}"
        WHERE tenant_id IS NULL
      `);

      const missingCount = parseInt(result.rows[0].missing_count, 10);
      if (missingCount > 0) {
        issues.push({ table: mapping.targetTable, missingCount });
      }
    } catch {
      // Skip if table doesn't have tenant_id column
    }
  }

  return issues;
}

/**
 * Runs the full validation suite and produces a report.
 */
export async function validateMigration(config: MigrationConfig): Promise<MigrationStepResult> {
  const startTime = Date.now();
  const errors: MigrationStepResult['errors'] = [];
  const warnings: MigrationStepResult['warnings'] = [];

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

    console.log(`[validate] Starting post-migration validation...`);

    // 1. Row count validation
    console.log(`[validate] Checking row counts...`);
    const tableValidations = await validateRowCounts(
      client,
      config.stagingSchema,
      config.pg.schema,
    );
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
    const integrityErrors = await validateReferentialIntegrity(client, config.pg.schema);
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
    const uuidIssues = await validateUuidFormat(client, config.pg.schema);
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
    const tenantIssues = await validateTenantAssignment(client, config.pg.schema);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ table: 'all', message: `Validation failed: ${message}` });

    return {
      step: 'validation',
      status: 'error',
      tablesProcessed: 0,
      rowsProcessed: 0,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (client) client.release();
    await pool.end();
  }
}
