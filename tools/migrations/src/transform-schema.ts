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

import { applyEnumOverrides, loadEnumOverrides } from './enum-overrides.js';
import { TABLE_MAPPINGS } from './table-mappings.js';
import type {
  MigrationConfig,
  MigrationStepResult,
  TableMapping,
  ColumnTransform,
} from './types.js';
import { quoteIdent, quoteLiteral, assertSafeTypeName } from './sql-safety.js';

/**
 * Builds the SQL expression for a column transformation.
 */
export function buildTransformExpression(
  sourceColumn: string,
  transform: ColumnTransform | undefined,
): string {
  if (!transform) {
    return `s.${quoteIdent(sourceColumn)}`;
  }

  switch (transform.type) {
    case 'rename':
      return `s.${quoteIdent(sourceColumn)}`;

    case 'cast':
      return `CAST(s.${quoteIdent(sourceColumn)} AS ${assertSafeTypeName(transform.targetType)})`;

    case 'default':
      return `COALESCE(s.${quoteIdent(sourceColumn)}, ${quoteLiteral(transform.value)})`;

    case 'map_enum': {
      const cases = Object.entries(transform.mapping)
        .map(([from, to]) => `WHEN CAST(s.${quoteIdent(sourceColumn)} AS text) = ${quoteLiteral(from)} THEN ${quoteLiteral(to)}`)
        .join(' ');
      // Unknown or NULL legacy codes map to NULL — never to an arbitrary
      // mapped value. The pre-flight (findUnmappedEnumCodes) fails the step
      // before any row with an unmapped non-NULL code is written.
      return `CASE ${cases} ELSE NULL END`;
    }

    case 'json_wrap':
      return `COALESCE(s.${quoteIdent(sourceColumn)}::jsonb, '{}'::jsonb)`;

    case 'coalesce':
      return `COALESCE(s.${quoteIdent(sourceColumn)}, ${quoteLiteral(transform.fallback)})`;

    default:
      return `s.${quoteIdent(sourceColumn)}`;
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
    return `${expr} AS ${quoteIdent(col.target)}`;
  });

  const targetColumns = mapping.columns.map((col) => `${quoteIdent(col.target)}`);

  const filterClause = mapping.sourceFilter ? `WHERE ${mapping.sourceFilter}` : '';

  return `
    INSERT INTO ${quoteIdent(targetSchema)}.${quoteIdent(mapping.targetTable)} (${targetColumns.join(', ')})
    SELECT ${selectColumns.join(',\n           ')}
    FROM ${quoteIdent(stagingSchema)}.${quoteIdent(mapping.sourceTable)} s
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
    .map((code) => `${quoteLiteral(code.replace(/'/g, "''"))}`)
    .join(', ');
  const src = `CAST(s.${quoteIdent(column.source)} AS text)`;
  const filter = mapping.sourceFilter ? `AND (${mapping.sourceFilter})` : '';
  const notIn = known ? `AND ${src} NOT IN (${known})` : '';
  return `
    SELECT ${src} AS code, COUNT(*)::int AS count
    FROM ${quoteIdent(stagingSchema)}.${quoteIdent(mapping.sourceTable)} s
    WHERE s.${quoteIdent(column.source)} IS NOT NULL ${notIn} ${filter}
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
 * writing any row) when a legacy code has no mapping.
 */
export async function transformTable(
  client: Pick<PoolClient, 'query'>,
  mapping: TableMapping,
  stagingSchema: string,
  targetSchema: string,
): Promise<number> {
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
  const result = await client.query(buildTransformSQL(mapping, stagingSchema, targetSchema));
  return result.rowCount ?? 0;
}

/**
 * Generates the materialized path for area hierarchy nodes.
 * The path is built by traversing parent_id references.
 */
function buildPathUpdateSQL(targetSchema: string): string {
  return `
    WITH RECURSIVE area_path AS (
      SELECT id, name, parent_id, name::text AS path, 1 AS depth
      FROM ${quoteIdent(targetSchema)}."geographic_areas"
      WHERE parent_id IS NULL

      UNION ALL

      SELECT ga.id, ga.name, ga.parent_id,
             ap.path || '/' || ga.name,
             ap.depth + 1
      FROM ${quoteIdent(targetSchema)}."geographic_areas" ga
      JOIN area_path ap ON ga.parent_id = ap.id
    )
    UPDATE ${quoteIdent(targetSchema)}."geographic_areas" ga
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

    // PRC-H105: owner code tables (OPENEMIS_ENUM_OVERRIDES) extend the built-in mappings.
    const mappings = applyEnumOverrides(TABLE_MAPPINGS, loadEnumOverrides());
    for (const mapping of mappings) {
      try {
        console.log(`[transform] Processing: ${mapping.sourceTable} → ${mapping.targetTable}`);

        const rows = await transformTable(client, mapping, config.stagingSchema, config.pg.schema);

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
