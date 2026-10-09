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

import type { PoolClient } from 'pg';
import { Pool } from 'pg';

import { TABLE_MAPPINGS } from './table-mappings.js';
import type {
  MigrationConfig,
  MigrationStepResult,
  TableMapping,
  ColumnTransform,
} from './types.js';

/**
 * Builds the SQL expression for a column transformation.
 */
export function buildTransformExpression(
  sourceColumn: string,
  transform: ColumnTransform | undefined,
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
      // Unknown or NULL legacy codes map to NULL — never to an arbitrary
      // mapped value. The pre-flight (findUnmappedEnumCodes) fails the step
      // before any row with an unmapped non-NULL code is written.
      return `CASE ${cases} ELSE NULL END`;
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
export function buildTransformSQL(
  mapping: TableMapping,
  stagingSchema: string,
  targetSchema: string,
): string {
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

/** Distinct non-NULL legacy codes of a map_enum column that have no mapping. */
export interface UnmappedEnumCodes {
  sourceTable: string;
  sourceColumn: string;
  targetColumn: string;
  codes: { code: string; count: number }[];
}

/**
 * Builds the pre-flight query that lists source codes of a map_enum column not
 * covered by its mapping. Returns null for non-enum columns.
 */
export function buildUnmappedEnumSQL(
  mapping: TableMapping,
  column: TableMapping['columns'][number],
  stagingSchema: string,
): string | null {
  if (column.transform?.type !== 'map_enum') return null;
  const known = Object.keys(column.transform.mapping)
    .map((code) => `'${code.replace(/'/g, "''")}'`)
    .join(', ');
  const src = `CAST(s."${column.source}" AS text)`;
  const filter = mapping.sourceFilter ? `AND (${mapping.sourceFilter})` : '';
  const notIn = known ? `AND ${src} NOT IN (${known})` : '';
  return `
    SELECT ${src} AS code, COUNT(*)::int AS count
    FROM "${stagingSchema}"."${mapping.sourceTable}" s
    WHERE s."${column.source}" IS NOT NULL ${notIn} ${filter}
    GROUP BY 1
    ORDER BY 1;
  `;
}

/**
 * Pre-flight: reports every map_enum column of a mapping with source codes that
 * are not in the mapping. Any non-empty result must fail the transform step.
 */
export async function findUnmappedEnumCodes(
  client: Pick<PoolClient, 'query'>,
  mapping: TableMapping,
  stagingSchema: string,
): Promise<UnmappedEnumCodes[]> {
  const found: UnmappedEnumCodes[] = [];
  for (const column of mapping.columns) {
    const sql = buildUnmappedEnumSQL(mapping, column, stagingSchema);
    if (!sql) continue;
    const result = await client.query<{ code: string; count: number }>(sql);
    if (result.rows.length > 0) {
      found.push({
        sourceTable: mapping.sourceTable,
        sourceColumn: column.source,
        targetColumn: column.target,
        codes: result.rows.map((r) => ({ code: String(r.code), count: Number(r.count) })),
      });
    }
  }
  return found;
}

/**
 * Transforms one mapping after the unmapped-enum pre-flight. Throws (without
 * writing any row) when a legacy code has no mapping. Returns the number of rows
 * actually inserted AND the number of source rows that were silently dropped by
 * ON CONFLICT DO NOTHING (PRC-M556 — a non-zero drop count is a data-loss signal
 * the caller must surface, not hide).
 */
export async function transformTable(
  client: Pick<PoolClient, 'query'>,
  mapping: TableMapping,
  stagingSchema: string,
  targetSchema: string,
): Promise<{ inserted: number; dropped: number }> {
  const unmapped = await findUnmappedEnumCodes(client, mapping, stagingSchema);
  if (unmapped.length > 0) {
    const detail = unmapped
      .map(
        (u) =>
          `${u.sourceColumn}→${u.targetColumn}: ${u.codes.map((c) => `${c.code}(${c.count})`).join(', ')}`,
      )
      .join('; ');
    throw new Error(`Unmapped legacy enum codes in ${mapping.sourceTable}: ${detail}`);
  }
  // Count candidate source rows (same filter) so ON CONFLICT DO NOTHING cannot
  // silently discard rows without the migration noticing.
  const filterClause = mapping.sourceFilter ? `WHERE ${mapping.sourceFilter}` : '';
  const sourceCountSql = `SELECT COUNT(*)::int AS c FROM "${stagingSchema}"."${mapping.sourceTable}" s ${filterClause}`;
  const sourceCount = Number((await client.query<{ c: number }>(sourceCountSql)).rows[0]?.c ?? 0);
  const result = await client.query(buildTransformSQL(mapping, stagingSchema, targetSchema));
  const inserted = result.rowCount ?? 0;
  const dropped = Math.max(0, sourceCount - inserted);
  return { inserted, dropped };
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
      // PRC-M556: a failed statement poisons the whole transaction, so without a
      // SAVEPOINT every later table failed with "current transaction is aborted"
      // yet the loop kept going and COMMIT ran at the end — committing nothing
      // while reporting partial success. Wrap each table in a SAVEPOINT so one
      // table's failure rolls back only that table and the rest proceed cleanly.
      await client.query(`SAVEPOINT transform_table`);
      try {
        console.log(`[transform] Processing: ${mapping.sourceTable} → ${mapping.targetTable}`);

        const { inserted, dropped } = await transformTable(
          client,
          mapping,
          config.stagingSchema,
          config.pg.schema,
        );

        if (dropped > 0) {
          // PRC-M556: ON CONFLICT DO NOTHING silently discarded source rows.
          // That is data loss, not success — record it as an error.
          throw new Error(
            `${dropped} source row(s) dropped by ON CONFLICT (inserted ${inserted} of ${inserted + dropped})`,
          );
        }

        await client.query(`RELEASE SAVEPOINT transform_table`);
        console.log(`[transform]   ✓ ${inserted} rows transformed`);
        tablesProcessed++;
        rowsProcessed += inserted;
      } catch (error) {
        // Roll back just this table so the transaction stays usable.
        await client.query(`ROLLBACK TO SAVEPOINT transform_table`);
        await client.query(`RELEASE SAVEPOINT transform_table`);
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
    await client.query(`SAVEPOINT transform_paths`);
    try {
      await client.query(buildPathUpdateSQL(config.pg.schema));
      await client.query(`RELEASE SAVEPOINT transform_paths`);
      console.log(`[transform]   ✓ Area paths generated`);
    } catch (error) {
      await client.query(`ROLLBACK TO SAVEPOINT transform_paths`);
      await client.query(`RELEASE SAVEPOINT transform_paths`);
      const message = error instanceof Error ? error.message : String(error);
      warnings.push({ table: 'geographic_areas', message: `Path generation warning: ${message}` });
    }

    // PRC-M556: only commit a clean transform. Any table error means we must not
    // persist a half-migrated schema; roll the whole thing back instead.
    if (errors.length > 0) {
      await client.query('ROLLBACK');
      return {
        step: 'schema-transformation',
        status: 'error',
        tablesProcessed,
        rowsProcessed,
        errors,
        warnings,
        durationMs: Date.now() - startTime,
      };
    }

    await client.query('COMMIT');

    return {
      step: 'schema-transformation',
      status: warnings.length > 0 ? 'warning' : 'success',
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
