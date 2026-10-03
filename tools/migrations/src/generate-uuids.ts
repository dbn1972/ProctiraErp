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
 */

import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

import { TABLE_MAPPINGS } from './table-mappings.js';
import type { MigrationConfig, MigrationStepResult } from './types.js';
import { MIGRATION_UUID_MAP_TABLE } from './types.js';
import { quoteIdent } from './sql-safety.js';

/**
 * SQL to create the UUID mapping table.
 */
const CREATE_MAPPING_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${MIGRATION_UUID_MAP_TABLE} (
    legacy_table VARCHAR(100) NOT NULL,
    legacy_id BIGINT NOT NULL,
    new_uuid UUID NOT NULL DEFAULT uuid_generate_v4(),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (legacy_table, legacy_id)
  );
  CREATE INDEX IF NOT EXISTS idx_uuid_map_uuid ON ${MIGRATION_UUID_MAP_TABLE} (new_uuid);
  CREATE INDEX IF NOT EXISTS idx_uuid_map_table ON ${MIGRATION_UUID_MAP_TABLE} (legacy_table);
`;

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
    `SELECT COUNT(*) as total FROM ${quoteIdent(stagingSchema)}.${quoteIdent(sourceTable)} ${filterClause}`,
  );
  const totalRows = parseInt(countResult.rows[0]!.total, 10);

  if (totalRows === 0) return 0;

  let processed = 0;
  let offset = 0;

  while (offset < totalRows) {
    // Fetch a batch of legacy IDs
    const batchResult = await client.query<{ legacy_id: number }>(
      `SELECT ${quoteIdent(pkColumn)} as legacy_id
       FROM ${quoteIdent(stagingSchema)}.${quoteIdent(sourceTable)}
       ${filterClause}
       ORDER BY ${quoteIdent(pkColumn)}
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

/**
 * Updates a target table's primary key column with generated UUIDs.
 */
async function applyUuidsToTable(
  client: PoolClient,
  targetSchema: string,
  targetTable: string,
  sourceTable: string,
): Promise<number> {
  // Add a temporary legacy_id column if not present
  await client.query(`
    ALTER TABLE ${quoteIdent(targetSchema)}.${quoteIdent(targetTable)}
    ADD COLUMN IF NOT EXISTS _legacy_id BIGINT;
  `);

  // Update the UUID primary key from the mapping table
  const result = await client.query(
    `
    UPDATE ${quoteIdent(targetSchema)}.${quoteIdent(targetTable)} t
    SET id = m.new_uuid::text
    FROM ${MIGRATION_UUID_MAP_TABLE} m
    WHERE m.legacy_table = $1
      AND m.legacy_id = t._legacy_id::bigint
  `,
    [sourceTable],
  );

  return result.rowCount ?? 0;
}

/**
 * Remaps foreign key columns using the UUID mapping table.
 */
export async function remapForeignKeys(
  client: PoolClient,
  targetSchema: string,
  targetTable: string,
  fkColumn: string,
  referencedSourceTable: string,
): Promise<number> {
  const result = await client.query(
    `
    UPDATE ${quoteIdent(targetSchema)}.${quoteIdent(targetTable)} t
    SET ${quoteIdent(fkColumn)} = m.new_uuid::text
    FROM ${MIGRATION_UUID_MAP_TABLE} m
    WHERE m.legacy_table = $1
      AND m.legacy_id = CAST(t.${quoteIdent(fkColumn)} AS bigint)
      AND t.${quoteIdent(fkColumn)} IS NOT NULL
      AND t.${quoteIdent(fkColumn)} ~ '^[0-9]+$'
  `,
    [referencedSourceTable],
  );

  return result.rowCount ?? 0;
}

/**
 * Executes UUID generation for all mapped tables.
 */
export async function generateUuids(config: MigrationConfig): Promise<MigrationStepResult> {
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
    await client.query('BEGIN');

    // Ensure uuid-ossp extension is available
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');

    // Create the mapping table
    console.log(`[uuid-gen] Creating UUID mapping table...`);
    await client.query(CREATE_MAPPING_TABLE_SQL);

    // Phase 1: Generate UUID mappings for all tables
    console.log(`[uuid-gen] Phase 1: Generating UUID mappings...`);
    for (const mapping of TABLE_MAPPINGS) {
      if (!mapping.requiresUuidGeneration) continue;

      try {
        console.log(`[uuid-gen]   Processing: ${mapping.sourceTable} (→ ${mapping.targetTable})`);
        const count = await generateUuidsForTable(
          client,
          config.stagingSchema,
          mapping.sourceTable,
          mapping.legacyPkColumn,
          config.batchSize,
          mapping.sourceFilter,
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
    for (const mapping of TABLE_MAPPINGS) {
      if (!mapping.requiresUuidGeneration) continue;

      try {
        const count = await applyUuidsToTable(
          client,
          config.pg.schema,
          mapping.targetTable,
          mapping.sourceTable,
        );
        console.log(`[uuid-gen]   ✓ ${mapping.targetTable}: ${count} PKs updated`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ table: mapping.targetTable, message: `PK update failed: ${message}` });
      }
    }

    // Phase 3: Remap foreign keys
    console.log(`[uuid-gen] Phase 3: Remapping foreign keys...`);
    for (const mapping of TABLE_MAPPINGS) {
      for (const fk of mapping.foreignKeys) {
        try {
          const count = await remapForeignKeys(
            client,
            config.pg.schema,
            mapping.targetTable,
            fk.column,
            fk.referencesTable,
          );
          console.log(
            `[uuid-gen]   ✓ ${mapping.targetTable}.${fk.column} → ${fk.targetReferencesTable}: ${count} FKs remapped`,
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          warnings.push({
            table: mapping.targetTable,
            message: `FK remap warning for ${fk.column}: ${message}`,
          });
        }
      }
    }

    await client.query('COMMIT');

    return {
      step: 'uuid-generation',
      status: errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'success',
      tablesProcessed,
      rowsProcessed,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    if (client) await client.query('ROLLBACK');
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
    await pool.end();
  }
}
