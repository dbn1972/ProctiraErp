/**
 * UUID generation for legacy integer primary keys.
 *
 * The legacy ProctiraERP system uses auto-increment integer PKs.
 * The new system uses UUID v4 primary keys. This script:
 *
 * 1. Creates a UUID mapping table (legacy_table, legacy_id) → new_uuid
 * 2. Generates UUIDs for all rows in each mapped table
 * 3. Updates the target tables with generated UUIDs
 * 4. Remaps all foreign key references using the mapping table
 *
 * The mapping table is preserved for audit/rollback purposes.
 *
 * PRC-M553 semantics:
 * - the transform step copies the legacy integer PK into the target `id`; phase 2 first
 *   records it in `_legacy_id` (it used to join on a `_legacy_id` that was never
 *   populated, so no PK was ever updated) and then swaps `id` for the mapped UUID;
 * - casts follow the real column types (text/varchar or uuid) instead of assuming text;
 * - every table step runs in its own SAVEPOINT and is checked afterwards: a PK left
 *   without a UUID, or a numeric FK left without a mapping, is an error;
 * - any error rolls the whole run back. It used to COMMIT a transaction that an earlier
 *   failed statement had already aborted, while reporting per-table progress.
 * Re-running after success is a no-op (already converted rows are skipped).
 */

import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

import { TABLE_MAPPINGS } from './table-mappings.js';
import type { MigrationConfig, MigrationStepResult, TableMapping } from './types.js';
import { MIGRATION_UUID_MAP_TABLE } from './types.js';

/**
 * SQL to create the UUID mapping table. `gen_random_uuid()` is built in (PG 13+), so no
 * extension has to be created by the migration role.
 */
const CREATE_MAPPING_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${MIGRATION_UUID_MAP_TABLE} (
    legacy_table VARCHAR(100) NOT NULL,
    legacy_id BIGINT NOT NULL,
    new_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (legacy_table, legacy_id)
  );
  CREATE INDEX IF NOT EXISTS idx_uuid_map_uuid ON ${MIGRATION_UUID_MAP_TABLE} (new_uuid);
  CREATE INDEX IF NOT EXISTS idx_uuid_map_table ON ${MIGRATION_UUID_MAP_TABLE} (legacy_table);
`;

/** Column types that can hold either the legacy integer (as text) or the UUID. */
const TEXT_TYPES = new Set(['text', 'character varying', 'character']);

/**
 * Generates UUIDs for all rows in a staging table and stores the mapping.
 * Uses batch processing to handle large tables efficiently.
 */
export async function generateUuidsForTable(
  client: PoolClient,
  stagingSchema: string,
  sourceTable: string,
  pkColumn: string,
  batchSize: number,
  sourceFilter?: string,
): Promise<number> {
  // Count total rows to process
  const filterClause = sourceFilter ? `WHERE ${sourceFilter}` : '';
  const countResult = await client.query<{ total: string }>(
    `SELECT COUNT(*) as total FROM "${stagingSchema}"."${sourceTable}" ${filterClause}`,
  );
  const totalRows = parseInt(countResult.rows[0]!.total, 10);

  if (totalRows === 0) return 0;

  let processed = 0;
  let offset = 0;

  while (offset < totalRows) {
    // Fetch a batch of legacy IDs
    const batchResult = await client.query<{ legacy_id: number }>(
      `SELECT "${pkColumn}" as legacy_id
       FROM "${stagingSchema}"."${sourceTable}"
       ${filterClause}
       ORDER BY "${pkColumn}"
       LIMIT $1 OFFSET $2`,
      [batchSize, offset],
    );

    if (batchResult.rows.length === 0) break;

    // Generate UUIDs and insert mappings in bulk
    const values: string[] = [];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    for (const row of batchResult.rows) {
      const uuid = uuidv4();
      values.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}::uuid)`);
      params.push(sourceTable, row.legacy_id, uuid);
      paramIdx += 3;
    }

    await client.query(
      `INSERT INTO ${MIGRATION_UUID_MAP_TABLE} (legacy_table, legacy_id, new_uuid)
       VALUES ${values.join(', ')}
       ON CONFLICT (legacy_table, legacy_id) DO NOTHING`,
      params,
    );

    processed += batchResult.rows.length;
    offset += batchSize;
  }

  return processed;
}

/** Returns the column's `information_schema` data_type, or null when it does not exist. */
async function columnType(
  client: Pick<PoolClient, 'query'>,
  schema: string,
  table: string,
  column: string,
): Promise<string | null> {
  const result = await client.query<{ data_type: string }>(
    `SELECT data_type FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    [schema, table, column],
  );
  return result.rows[0]?.data_type ?? null;
}

function uuidCastFor(dataType: string, where: string): string {
  if (dataType === 'uuid') return 'm.new_uuid';
  if (TEXT_TYPES.has(dataType)) return 'm.new_uuid::text';
  throw new Error(`${where} has type ${dataType}; it must be uuid or text to hold a UUID`);
}

/**
 * Updates a target table's primary key column with generated UUIDs.
 * Returns the number of rows converted on this call.
 */
export async function applyUuidsToTable(
  client: PoolClient,
  targetSchema: string,
  targetTable: string,
  sourceTable: string,
): Promise<number> {
  const target = `"${targetSchema}"."${targetTable}"`;
  const idType = await columnType(client, targetSchema, targetTable, 'id');
  if (!idType) throw new Error(`${target} has no id column`);
  const setId = uuidCastFor(idType, `${target}.id`);

  // Keep the legacy integer id for audit, rollback and the join below.
  await client.query(`ALTER TABLE ${target} ADD COLUMN IF NOT EXISTS _legacy_id BIGINT`);
  if (TEXT_TYPES.has(idType)) {
    await client.query(
      `UPDATE ${target}
       SET _legacy_id = id::bigint
       WHERE _legacy_id IS NULL AND id ~ '^[0-9]+$'`,
    );
  }

  // Convert only rows still carrying their legacy id (idempotent re-runs).
  const result = await client.query(
    `UPDATE ${target} t
     SET id = ${setId}
     FROM ${MIGRATION_UUID_MAP_TABLE} m
     WHERE m.legacy_table = $1
       AND m.legacy_id = t._legacy_id
       AND t.id::text = t._legacy_id::text`,
    [sourceTable],
  );

  const left = await client.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM ${target}
     WHERE _legacy_id IS NOT NULL AND id::text = _legacy_id::text`,
  );
  const remaining = Number(left.rows[0]?.c ?? 0);
  if (remaining > 0) {
    throw new Error(`${remaining} row(s) in ${target} have no UUID mapping (${sourceTable})`);
  }
  return result.rowCount ?? 0;
}

/**
 * Remaps foreign key columns using the UUID mapping table.
 * Returns the number of references remapped on this call; throws when a numeric legacy
 * reference has no mapping (it would otherwise stay behind as a dangling integer).
 */
export async function remapForeignKeys(
  client: PoolClient,
  targetSchema: string,
  targetTable: string,
  fkColumn: string,
  referencedSourceTable: string,
): Promise<number> {
  const target = `"${targetSchema}"."${targetTable}"`;
  const fkType = await columnType(client, targetSchema, targetTable, fkColumn);
  if (!fkType) throw new Error(`${target} has no column ${fkColumn}`);
  if (fkType === 'uuid') return 0; // a uuid column cannot hold a legacy integer
  const setFk = uuidCastFor(fkType, `${target}.${fkColumn}`);

  const result = await client.query(
    `
    UPDATE ${target} t
    SET "${fkColumn}" = ${setFk}
    FROM ${MIGRATION_UUID_MAP_TABLE} m
    WHERE m.legacy_table = $1
      AND t."${fkColumn}" IS NOT NULL
      AND t."${fkColumn}"::text ~ '^[0-9]+$'
      AND m.legacy_id = CAST(t."${fkColumn}"::text AS bigint)
  `,
    [referencedSourceTable],
  );

  const left = await client.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM ${target}
     WHERE "${fkColumn}" IS NOT NULL AND "${fkColumn}"::text ~ '^[0-9]+$'`,
  );
  const remaining = Number(left.rows[0]?.c ?? 0);
  if (remaining > 0) {
    throw new Error(
      `${remaining} ${targetTable}.${fkColumn} reference(s) have no ${referencedSourceTable} mapping`,
    );
  }
  return result.rowCount ?? 0;
}

export interface GenerateUuidsDeps {
  /** Pool to use (caller keeps ownership). Default: a pool built from config.pg. */
  pool?: Pool;
  /** Table mappings to process. Default: TABLE_MAPPINGS. */
  mappings?: TableMapping[];
}

/** Runs one table step inside a SAVEPOINT so a failure leaves the transaction usable. */
async function inSavepoint<T>(client: PoolClient, step: () => Promise<T>): Promise<T> {
  await client.query('SAVEPOINT uuid_step');
  try {
    const value = await step();
    await client.query('RELEASE SAVEPOINT uuid_step');
    return value;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT uuid_step');
    await client.query('RELEASE SAVEPOINT uuid_step');
    throw error;
  }
}

/**
 * Executes UUID generation for all mapped tables.
 */
export async function generateUuids(
  config: MigrationConfig,
  deps: GenerateUuidsDeps = {},
): Promise<MigrationStepResult> {
  const startTime = Date.now();
  const errors: MigrationStepResult['errors'] = [];
  const warnings: MigrationStepResult['warnings'] = [];
  const mappings = deps.mappings ?? TABLE_MAPPINGS;
  let tablesProcessed = 0;
  let rowsProcessed = 0;

  const ownsPool = !deps.pool;
  const pool =
    deps.pool ??
    new Pool({
      host: config.pg.host,
      port: config.pg.port,
      database: config.pg.database,
      user: config.pg.user,
      password: config.pg.password,
    });

  let client: PoolClient | null = null;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Create the mapping table
    console.log(`[uuid-gen] Creating UUID mapping table...`);
    await client.query(CREATE_MAPPING_TABLE_SQL);

    // Phase 1: Generate UUID mappings for all tables
    console.log(`[uuid-gen] Phase 1: Generating UUID mappings...`);
    for (const mapping of mappings) {
      if (!mapping.requiresUuidGeneration) continue;
      const c = client;
      try {
        console.log(`[uuid-gen]   Processing: ${mapping.sourceTable} (→ ${mapping.targetTable})`);
        const count = await inSavepoint(c, () =>
          generateUuidsForTable(
            c,
            config.stagingSchema,
            mapping.sourceTable,
            mapping.legacyPkColumn,
            config.batchSize,
            mapping.sourceFilter,
          ),
        );
        console.log(`[uuid-gen]     ✓ ${count} UUIDs generated`);
        tablesProcessed++;
        rowsProcessed += count;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ table: mapping.sourceTable, message: `UUID generation failed: ${message}` });
        console.error(`[uuid-gen]     ✗ Error: ${message}`);
      }
    }

    // Phase 2: Apply UUIDs to target table PKs
    console.log(`[uuid-gen] Phase 2: Applying UUIDs to primary keys...`);
    for (const mapping of mappings) {
      if (!mapping.requiresUuidGeneration) continue;
      const c = client;
      try {
        const count = await inSavepoint(c, () =>
          applyUuidsToTable(c, config.pg.schema, mapping.targetTable, mapping.sourceTable),
        );
        console.log(`[uuid-gen]   ✓ ${mapping.targetTable}: ${count} PKs updated`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ table: mapping.targetTable, message: `PK update failed: ${message}` });
        console.error(`[uuid-gen]   ✗ ${mapping.targetTable}: ${message}`);
      }
    }

    // Phase 3: Remap foreign keys
    console.log(`[uuid-gen] Phase 3: Remapping foreign keys...`);
    for (const mapping of mappings) {
      for (const fk of mapping.foreignKeys) {
        const c = client;
        try {
          const count = await inSavepoint(c, () =>
            remapForeignKeys(
              c,
              config.pg.schema,
              mapping.targetTable,
              fk.column,
              fk.referencesTable,
            ),
          );
          console.log(
            `[uuid-gen]   ✓ ${mapping.targetTable}.${fk.column} → ${fk.targetReferencesTable}: ${count} FKs remapped`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push({
            table: mapping.targetTable,
            message: `FK remap failed for ${fk.column}: ${message}`,
          });
          console.error(`[uuid-gen]   ✗ ${mapping.targetTable}.${fk.column}: ${message}`);
        }
      }
    }

    // Only a clean run is committed; a half-converted key space is worse than none.
    if (errors.length > 0) {
      await client.query('ROLLBACK');
      return {
        step: 'uuid-generation',
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
      step: 'uuid-generation',
      status: warnings.length > 0 ? 'warning' : 'success',
      tablesProcessed,
      rowsProcessed,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ table: 'all', message: `UUID generation transaction failed: ${message}` });

    return {
      step: 'uuid-generation',
      status: 'error',
      tablesProcessed,
      rowsProcessed,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (client) client.release();
    if (ownsPool) await pool.end();
  }
}
