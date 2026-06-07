/**
 * Schema transformation: maps legacy CakePHP tables to new Prisma models.
 *
 * After pgloader loads raw data into the staging schema, this script:
 * 1. Creates transformed tables in the target schema
 * 2. Applies column renames and type transformations
 * 3. Handles the security_users split (students vs staff)
 * 4. Maps enum values from integer IDs to string values
 * 5. Generates materialized path for area hierarchy
 */

import { Pool, PoolClient } from 'pg';
import { loadConfig } from './config.js';
import { MigrationConfig, MigrationStepResult, TableMapping, ColumnTransform } from './types.js';
import { TABLE_MAPPINGS } from './table-mappings.js';

/**
 * Builds the SQL expression for a column transformation.
 */
export function buildTransformExpression(
  sourceColumn: string,
  transform: ColumnTransform | undefined
): string {
  if (!transform) {
    return `s."${sourceColumn}"`;
  }

  switch (transform.type) {
    case 'rename':
      return `s."${sourceColumn}"`;

    case 'cast':
      return `CAST(s."${sourceColumn}" AS ${transform.targetType})`;

    case 'default':
      return `COALESCE(s."${sourceColumn}", '${transform.value}')`;

    case 'map_enum': {
      const cases = Object.entries(transform.mapping)
        .map(([from, to]) => `WHEN CAST(s."${sourceColumn}" AS text) = '${from}' THEN '${to}'`)
        .join(' ');
      const fallback = Object.values(transform.mapping)[0] ?? 'unknown';
      return `CASE ${cases} ELSE '${fallback}' END`;
    }

    case 'json_wrap':
      return `COALESCE(s."${sourceColumn}"::jsonb, '{}'::jsonb)`;

    case 'coalesce':
      return `COALESCE(s."${sourceColumn}", '${transform.fallback}')`;

    default:
      return `s."${sourceColumn}"`;
  }
}

/**
 * Builds the INSERT...SELECT SQL for transforming a single table mapping.
 */
export function buildTransformSQL(mapping: TableMapping, stagingSchema: string, targetSchema: string): string {
  const selectColumns = mapping.columns.map((col) => {
    const expr = buildTransformExpression(col.source, col.transform);
    return `${expr} AS "${col.target}"`;
  });

  const targetColumns = mapping.columns.map((col) => `"${col.target}"`);

  const filterClause = mapping.sourceFilter ? `WHERE ${mapping.sourceFilter}` : '';

  return `
    INSERT INTO "${targetSchema}"."${mapping.targetTable}" (${targetColumns.join(', ')})
    SELECT ${selectColumns.join(',\n           ')}
    FROM "${stagingSchema}"."${mapping.sourceTable}" s
    ${filterClause}
    ON CONFLICT DO NOTHING;
  `;
}

/**
 * Generates the materialized path for area hierarchy nodes.
 * The path is built by traversing parent_id references.
 */
function buildPathUpdateSQL(targetSchema: string): string {
  return `
    WITH RECURSIVE area_path AS (
      SELECT id, name, parent_id, name::text AS path, 1 AS depth
      FROM "${targetSchema}"."geographic_areas"
      WHERE parent_id IS NULL

      UNION ALL

      SELECT ga.id, ga.name, ga.parent_id,
             ap.path || '/' || ga.name,
             ap.depth + 1
      FROM "${targetSchema}"."geographic_areas" ga
      JOIN area_path ap ON ga.parent_id = ap.id
    )
    UPDATE "${targetSchema}"."geographic_areas" ga
    SET path = ap.path
    FROM area_path ap
    WHERE ga.id = ap.id;
  `;
}

/**
 * Executes the schema transformation for all table mappings.
 */
export async function transformSchema(config: MigrationConfig): Promise<MigrationStepResult> {
  const startTime = Date.now();
  const errors: MigrationStepResult['errors'] = [];
  const warnings: MigrationStepResult['warnings'] = [];
  let tablesProcessed = 0;
  let rowsProcessed = 0;

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

    // Begin transaction for atomicity
    await client.query('BEGIN');

    console.log(`[transform] Starting schema transformation...`);
    console.log(`[transform] Staging: ${config.stagingSchema} → Target: ${config.pg.schema}`);

    for (const mapping of TABLE_MAPPINGS) {
      try {
        console.log(`[transform] Processing: ${mapping.sourceTable} → ${mapping.targetTable}`);

        const sql = buildTransformSQL(mapping, config.stagingSchema, config.pg.schema);
        const result = await client.query(sql);
        const rows = result.rowCount ?? 0;

        console.log(`[transform]   ✓ ${rows} rows transformed`);
        tablesProcessed++;
        rowsProcessed += rows;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({
          table: mapping.sourceTable,
          message: `Transform failed: ${message}`,
        });
        console.error(`[transform]   ✗ Error: ${message}`);
      }
    }

    // Build materialized paths for area hierarchy
    console.log(`[transform] Building area hierarchy paths...`);
    try {
      await client.query(buildPathUpdateSQL(config.pg.schema));
      console.log(`[transform]   ✓ Area paths generated`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push({ table: 'geographic_areas', message: `Path generation warning: ${message}` });
    }

    await client.query('COMMIT');

    return {
      step: 'schema-transformation',
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'success',
      tablesProcessed,
      rowsProcessed,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ table: 'all', message: `Transaction failed: ${message}` });

    return {
      step: 'schema-transformation',
      status: 'error',
      tablesProcessed,
      rowsProcessed,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (client) client.release();
    await pool.end();
  }
}
