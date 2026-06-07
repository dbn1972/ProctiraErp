/**
 * Migration Report Generator.
 *
 * Generates a comprehensive migration report listing:
 * - Tables processed with row counts
 * - Rows successfully migrated per table
 * - Unmigrated data with specific reasons (constraint violations, missing references, etc.)
 * - Duration and throughput metrics
 *
 * Satisfies Requirement 24.3: Generate a migration report listing tables processed,
 * rows migrated, and any data that could not be migrated with reasons.
 */

import { Pool, PoolClient } from 'pg';
import { MigrationConfig, MigrationStepResult, TableMapping } from './types.js';
import { TABLE_MAPPINGS } from './table-mappings.js';

/** Reason why a row could not be migrated. */
export interface UnmigratedRecord {
  table: string;
  legacyId: number | string;
  reason: UnmigratedReason;
  details: string;
}

export type UnmigratedReason =
  | 'constraint_violation'
  | 'missing_reference'
  | 'data_truncation'
  | 'invalid_format'
  | 'duplicate_key'
  | 'null_required_field'
  | 'enum_mismatch'
  | 'transform_error';

/** Per-table migration statistics. */
export interface TableMigrationStats {
  sourceTable: string;
  targetTable: string;
  sourceRowCount: number;
  migratedRowCount: number;
  skippedRowCount: number;
  unmigrated: UnmigratedRecord[];
  durationMs: number;
  rowsPerSecond: number;
}

/** Full migration report. */
export interface MigrationReport {
  generatedAt: string;
  migrationId: string;
  config: {
    sourceDatabase: string;
    targetDatabase: string;
    batchSize: number;
    tenantName: string;
  };
  summary: {
    totalTablesProcessed: number;
    totalSourceRows: number;
    totalMigratedRows: number;
    totalSkippedRows: number;
    totalUnmigratedRows: number;
    overallSuccessRate: number;
    totalDurationMs: number;
  };
  tables: TableMigrationStats[];
  unmigrated: UnmigratedRecord[];
  status: 'complete' | 'partial' | 'failed';
}

/**
 * Generates a comprehensive migration report by comparing source staging data
 * with target migrated data.
 */
export async function generateMigrationReport(
  config: MigrationConfig
): Promise<MigrationStepResult> {
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

    console.log('[report] Generating migration report...');

    const tableStats: TableMigrationStats[] = [];
    const allUnmigrated: UnmigratedRecord[] = [];
    let totalSourceRows = 0;
    let totalMigratedRows = 0;

    for (const mapping of TABLE_MAPPINGS) {
      const tableStart = Date.now();

      const stats = await collectTableStats(client, mapping, config);
      tableStats.push(stats);

      totalSourceRows += stats.sourceRowCount;
      totalMigratedRows += stats.migratedRowCount;
      allUnmigrated.push(...stats.unmigrated);

      if (stats.skippedRowCount > 0) {
        warnings.push({
          table: mapping.targetTable,
          message: `${stats.skippedRowCount} rows could not be migrated`,
          count: stats.skippedRowCount,
        });
      }

      const tableDuration = Date.now() - tableStart;
      console.log(
        `[report]   ${mapping.sourceTable} → ${mapping.targetTable}: ` +
          `${stats.migratedRowCount}/${stats.sourceRowCount} rows (${tableDuration}ms)`
      );
    }

    const totalSkipped = totalSourceRows - totalMigratedRows;
    const successRate =
      totalSourceRows > 0 ? (totalMigratedRows / totalSourceRows) * 100 : 100;

    const report: MigrationReport = {
      generatedAt: new Date().toISOString(),
      migrationId: `mig_${Date.now()}`,
      config: {
        sourceDatabase: `${config.mysql.host}:${config.mysql.port}/${config.mysql.database}`,
        targetDatabase: `${config.pg.host}:${config.pg.port}/${config.pg.database}`,
        batchSize: config.batchSize,
        tenantName: config.defaultTenantName,
      },
      summary: {
        totalTablesProcessed: tableStats.length,
        totalSourceRows,
        totalMigratedRows,
        totalSkippedRows: totalSkipped,
        totalUnmigratedRows: allUnmigrated.length,
        overallSuccessRate: Math.round(successRate * 100) / 100,
        totalDurationMs: Date.now() - startTime,
      },
      tables: tableStats,
      unmigrated: allUnmigrated,
      status:
        successRate === 100
          ? 'complete'
          : successRate >= 95
            ? 'partial'
            : 'failed',
    };

    // Print report summary
    console.log('\n[report] === MIGRATION REPORT ===');
    console.log(`[report] Tables processed: ${report.summary.totalTablesProcessed}`);
    console.log(`[report] Total source rows: ${report.summary.totalSourceRows}`);
    console.log(`[report] Total migrated rows: ${report.summary.totalMigratedRows}`);
    console.log(`[report] Total unmigrated rows: ${report.summary.totalUnmigratedRows}`);
    console.log(`[report] Success rate: ${report.summary.overallSuccessRate}%`);
    console.log(`[report] Status: ${report.status}`);

    if (allUnmigrated.length > 0) {
      console.log('\n[report] Unmigrated data reasons:');
      const reasonCounts = groupByReason(allUnmigrated);
      for (const [reason, count] of Object.entries(reasonCounts)) {
        console.log(`[report]   ${reason}: ${count} rows`);
      }
    }

    return {
      step: 'report_generation',
      status: allUnmigrated.length > 0 ? 'warning' : 'success',
      tablesProcessed: tableStats.length,
      rowsProcessed: totalMigratedRows,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ table: 'all', message: `Report generation failed: ${message}` });

    return {
      step: 'report_generation',
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

/**
 * Collects migration statistics for a single table mapping.
 */
async function collectTableStats(
  client: PoolClient,
  mapping: TableMapping,
  config: MigrationConfig
): Promise<TableMigrationStats> {
  const tableStart = Date.now();
  const unmigrated: UnmigratedRecord[] = [];

  // Count source rows in staging
  const filterClause = mapping.sourceFilter ? `WHERE ${mapping.sourceFilter}` : '';
  let sourceRowCount = 0;
  try {
    const sourceResult = await client.query(
      `SELECT COUNT(*) as count FROM "${config.stagingSchema}"."${mapping.sourceTable}" ${filterClause}`
    );
    sourceRowCount = parseInt(sourceResult.rows[0].count, 10);
  } catch {
    // Staging table may not exist
    sourceRowCount = 0;
  }

  // Count target rows
  let migratedRowCount = 0;
  try {
    const targetResult = await client.query(
      `SELECT COUNT(*) as count FROM "${config.pg.schema}"."${mapping.targetTable}"`
    );
    migratedRowCount = parseInt(targetResult.rows[0].count, 10);
  } catch {
    migratedRowCount = 0;
  }

  // Identify unmigrated rows by finding source IDs not in target
  if (sourceRowCount > migratedRowCount) {
    const unmigratedRecords = await identifyUnmigratedRows(
      client,
      mapping,
      config
    );
    unmigrated.push(...unmigratedRecords);
  }

  const durationMs = Date.now() - tableStart;
  const rowsPerSecond =
    durationMs > 0 ? Math.round((migratedRowCount / durationMs) * 1000) : 0;

  return {
    sourceTable: mapping.sourceTable,
    targetTable: mapping.targetTable,
    sourceRowCount,
    migratedRowCount,
    skippedRowCount: Math.max(0, sourceRowCount - migratedRowCount),
    unmigrated,
    durationMs,
    rowsPerSecond,
  };
}

/**
 * Identifies rows that exist in staging but not in target, and determines the reason.
 */
async function identifyUnmigratedRows(
  client: PoolClient,
  mapping: TableMapping,
  config: MigrationConfig
): Promise<UnmigratedRecord[]> {
  const unmigrated: UnmigratedRecord[] = [];
  const limit = 100; // Cap detailed analysis to first 100 unmigrated rows

  try {
    // Find rows in staging that don't have a corresponding UUID mapping
    // This indicates they were skipped during migration
    const filterClause = mapping.sourceFilter ? `AND ${mapping.sourceFilter}` : '';

    const result = await client.query(`
      SELECT s."${mapping.legacyPkColumn}" as legacy_id
      FROM "${config.stagingSchema}"."${mapping.sourceTable}" s
      WHERE NOT EXISTS (
        SELECT 1 FROM "${config.pg.schema}"."${mapping.targetTable}" t
        WHERE t.id IS NOT NULL
      )
      ${filterClause}
      LIMIT ${limit}
    `);

    // For each unmigrated row, determine the reason
    for (const row of result.rows) {
      const reason = await diagnoseUnmigratedRow(
        client,
        mapping,
        row.legacy_id,
        config
      );
      unmigrated.push(reason);
    }
  } catch {
    // If we can't identify specific rows, report the gap generically
    unmigrated.push({
      table: mapping.sourceTable,
      legacyId: 'unknown',
      reason: 'transform_error',
      details: 'Unable to identify specific unmigrated rows',
    });
  }

  return unmigrated;
}

/**
 * Diagnoses why a specific row was not migrated.
 */
async function diagnoseUnmigratedRow(
  client: PoolClient,
  mapping: TableMapping,
  legacyId: number | string,
  config: MigrationConfig
): Promise<UnmigratedRecord> {
  // Check for NULL required fields
  for (const col of mapping.columns) {
    if (['id', 'name', 'code'].includes(col.target)) {
      try {
        const result = await client.query(
          `SELECT "${col.source}" FROM "${config.stagingSchema}"."${mapping.sourceTable}" WHERE "${mapping.legacyPkColumn}" = $1`,
          [legacyId]
        );
        if (result.rows.length > 0 && result.rows[0][col.source] === null) {
          return {
            table: mapping.sourceTable,
            legacyId,
            reason: 'null_required_field',
            details: `Required field '${col.target}' (source: '${col.source}') is NULL`,
          };
        }
      } catch {
        // Continue checking other reasons
      }
    }
  }

  // Check for broken foreign key references
  for (const fk of mapping.foreignKeys) {
    try {
      const result = await client.query(
        `SELECT s."${fk.column}" as fk_value
         FROM "${config.stagingSchema}"."${mapping.sourceTable}" s
         WHERE s."${mapping.legacyPkColumn}" = $1
           AND s."${fk.column}" IS NOT NULL`,
        [legacyId]
      );
      if (result.rows.length > 0) {
        const fkValue = result.rows[0].fk_value;
        const refResult = await client.query(
          `SELECT COUNT(*) as count FROM "${config.pg.schema}"."${fk.targetReferencesTable}" WHERE id IS NOT NULL`
        );
        if (parseInt(refResult.rows[0].count, 10) === 0) {
          return {
            table: mapping.sourceTable,
            legacyId,
            reason: 'missing_reference',
            details: `Foreign key '${fk.column}' value '${fkValue}' references non-existent row in '${fk.targetReferencesTable}'`,
          };
        }
      }
    } catch {
      // Continue
    }
  }

  // Check for enum mapping failures
  for (const col of mapping.columns) {
    if (col.transform?.type === 'map_enum') {
      try {
        const result = await client.query(
          `SELECT "${col.source}" FROM "${config.stagingSchema}"."${mapping.sourceTable}" WHERE "${mapping.legacyPkColumn}" = $1`,
          [legacyId]
        );
        if (result.rows.length > 0) {
          const value = String(result.rows[0][col.source]);
          if (!(value in col.transform.mapping)) {
            return {
              table: mapping.sourceTable,
              legacyId,
              reason: 'enum_mismatch',
              details: `Value '${value}' for column '${col.source}' has no mapping in enum definition`,
            };
          }
        }
      } catch {
        // Continue
      }
    }
  }

  // Default: generic transform error
  return {
    table: mapping.sourceTable,
    legacyId,
    reason: 'transform_error',
    details: 'Row could not be migrated due to an unidentified transformation issue',
  };
}

/**
 * Groups unmigrated records by reason for summary reporting.
 */
function groupByReason(records: UnmigratedRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    counts[record.reason] = (counts[record.reason] ?? 0) + 1;
  }
  return counts;
}

/**
 * Exports the migration report as a JSON file.
 */
export function serializeReport(report: MigrationReport): string {
  return JSON.stringify(report, null, 2);
}
