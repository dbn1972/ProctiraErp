/**
 * PRC-M422 — unmapped staging table inventory.
 *
 * The migration maps only a fixed set of legacy tables (TABLE_MAPPINGS). Any
 * legacy table present in the staging schema that is NOT in that set is silently
 * ignored, yet the pipeline printed "Migration completed successfully!". This
 * inventory lists every staging table with no mapping so the orchestrator can
 * surface them as a blocking warning instead of a false green.
 */
import type { PoolClient } from 'pg';

import { TABLE_MAPPINGS } from './table-mappings.js';

export interface UnmappedStagingInventory {
  mappedTables: string[];
  stagingTables: string[];
  unmappedTables: string[];
}

/** Base tables physically present in the staging schema. */
export async function listStagingTables(
  client: Pick<PoolClient, 'query'>,
  stagingSchema: string,
): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = $1
        AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [stagingSchema],
  );
  return result.rows.map((r) => r.table_name);
}

/** Compares staging tables against TABLE_MAPPINGS source tables. */
export async function findUnmappedStagingTables(
  client: Pick<PoolClient, 'query'>,
  stagingSchema: string,
): Promise<UnmappedStagingInventory> {
  const mappedTables = [...new Set(TABLE_MAPPINGS.map((m) => m.sourceTable))].sort();
  const stagingTables = await listStagingTables(client, stagingSchema);
  const mappedSet = new Set(mappedTables);
  const unmappedTables = stagingTables.filter((t) => !mappedSet.has(t));
  return { mappedTables, stagingTables, unmappedTables };
}
