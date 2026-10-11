/**
 * Default tenant assignment during migration.
 *
 * The legacy system has no multi-tenancy concept. During migration, all existing
 * data is assigned to a single "default" tenant. Post-migration, administrators
 * can split data into multiple tenants as needed.
 *
 * This script:
 * 1. Creates (or finds) the default tenant record
 * 2. Sets tenant_id on all migrated rows in tenant-scoped tables
 * 3. Verifies no rows are left without a tenant assignment
 */

import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';

import { getAllTargetTables } from './table-mappings.js';
import type { MigrationConfig, MigrationStepResult } from './types.js';
import { MIGRATION_UUID_MAP_TABLE } from './types.js';

/**
 * Creates or retrieves the default tenant for migration.
 */
export async function ensureDefaultTenant(
  client: PoolClient,
  targetSchema: string,
  tenantName: string,
  tenantSlug: string,
): Promise<string> {
  // Check if default tenant already exists
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM "${targetSchema}"."tenants" WHERE slug = $1`,
    [tenantSlug],
  );

  if (existing.rows.length > 0) {
    return existing.rows[0]!.id;
  }

  // Create the default tenant
  const tenantId = uuidv4();
  await client.query(
    `INSERT INTO "${targetSchema}"."tenants" (id, name, slug, config, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
    [
      tenantId,
      tenantName,
      tenantSlug,
      JSON.stringify({ migrated: true, migratedAt: new Date().toISOString() }),
      'active',
    ],
  );

  console.log(`[tenant] Created default tenant: ${tenantName} (${tenantId})`);
  return tenantId;
}

/**
 * Assigns the default tenant_id to all rows in a tenant-scoped table.
 */
async function assignTenantToTable(
  client: Pick<PoolClient, 'query'>,
  targetSchema: string,
  table: string,
  tenantId: string,
): Promise<number> {
  // PRC-M554: tenant_id is a uuid column; comparing it to the empty string ('')
  // raises 22P02 (invalid input syntax for type uuid) and aborts the whole
  // transaction. Only `IS NULL` is a valid "unassigned" predicate for uuid.
  const result = await client.query(
    `UPDATE "${targetSchema}"."${table}"
     SET tenant_id = $1
     WHERE tenant_id IS NULL`,
    [tenantId],
  );

  return result.rowCount ?? 0;
}

/**
 * PRC-M554 — the tables this step assigns and verifies are exactly the
 * migration targets declared in `TABLE_MAPPINGS` (`getAllTargetTables()`),
 * intersected with the catalog tables in `targetSchema` that have a
 * `tenant_id` column.
 *
 * Why the mapping list and not catalog discovery:
 *  - The transform step never writes `tenant_id`, so the rows this step must
 *    stamp exist only in mapped target tables, and their `tenant_id` is NULL
 *    until this step runs. Filtering on `is_nullable = 'NO'` would select only
 *    columns that cannot hold NULL, making the UPDATE a guaranteed no-op and the
 *    verification tautological.
 *  - Non-mapped tables are never touched. In particular, platform-owned tables
 *    whose NULL `tenant_id` means "platform" (e.g. `control_plane_documents`,
 *    db/sql/022; `PgDocumentStore` treats `tenant_id IS NULL` as
 *    `{ platform: true }`) must never be re-homed into the migrated tenant.
 *
 * A mapped target that has no `tenant_id` column (or does not exist) is
 * returned in `missing`; the caller treats that as a hard error because
 * migrated rows in that table could not be tenant-scoped under RLS.
 */
export async function resolveTenantAssignmentTables(
  client: Pick<PoolClient, 'query'>,
  targetSchema: string,
): Promise<{ tables: string[]; missing: string[] }> {
  const targets = getAllTargetTables();
  const result = await client.query<{ table_name: string }>(
    `SELECT DISTINCT table_name
       FROM information_schema.columns
      WHERE table_schema = $1
        AND column_name = 'tenant_id'
        AND table_name = ANY($2::text[])`,
    [targetSchema, targets],
  );
  const withTenantId = new Set(result.rows.map((r) => r.table_name));
  // Iterate the mapping list (not the catalog rows) so a catalog that returns
  // extra tables can never widen the set beyond the declared migration targets.
  return {
    tables: targets.filter((t) => withTenantId.has(t)),
    missing: targets.filter((t) => !withTenantId.has(t)),
  };
}

/**
 * Verifies that no rows in tenant-scoped tables are missing a tenant_id.
 */
async function verifyTenantAssignment(
  client: Pick<PoolClient, 'query'>,
  targetSchema: string,
  tables: readonly string[],
): Promise<{ table: string; orphanedCount: number }[]> {
  const orphans: { table: string; orphanedCount: number }[] = [];

  for (const table of tables) {
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM "${targetSchema}"."${table}"
       WHERE tenant_id IS NULL`,
    );
    const count = parseInt(result.rows[0]!.count, 10);
    if (count > 0) {
      orphans.push({ table, orphanedCount: count });
    }
  }

  return orphans;
}

export interface TenantAssignmentOutcome {
  /** Mapped target tables that were assigned and verified. */
  tables: string[];
  /** Rows stamped per table. */
  assigned: { table: string; count: number }[];
  errors: MigrationStepResult['errors'];
}

/**
 * PRC-M554 — assign `tenantId` to every NULL-tenant row in the mapped migration
 * targets, then verify none remain. Runs inside the caller's transaction; the
 * caller must ROLLBACK when `errors` is non-empty.
 */
export async function assignAndVerifyTenant(
  client: Pick<PoolClient, 'query'>,
  targetSchema: string,
  tenantId: string,
): Promise<TenantAssignmentOutcome> {
  const errors: MigrationStepResult['errors'] = [];
  const assigned: { table: string; count: number }[] = [];

  const { tables, missing } = await resolveTenantAssignmentTables(client, targetSchema);
  for (const table of missing) {
    errors.push({
      table,
      message: `Mapped migration target has no tenant_id column in schema "${targetSchema}"`,
    });
    console.error(`[tenant]   ✗ ${table}: no tenant_id column`);
  }

  console.log(`[tenant] Assigning tenant_id to ${tables.length} mapped target table(s)...`);
  for (const table of tables) {
    try {
      const count = await assignTenantToTable(client, targetSchema, table, tenantId);
      console.log(`[tenant]   ✓ ${table}: ${count} rows assigned`);
      assigned.push({ table, count });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ table, message: `Tenant assignment failed: ${message}` });
      console.error(`[tenant]   ✗ ${table}: ${message}`);
    }
  }

  // PRC-M554: an orphan (row with no tenant) is a hard failure — a tenant-less
  // row is invisible under RLS and a data leak risk — not a warning. Verify the
  // same mapped targets BEFORE committing.
  console.log(`[tenant] Verifying tenant assignment completeness...`);
  const orphans = await verifyTenantAssignment(client, targetSchema, tables);
  for (const { table, orphanedCount } of orphans) {
    errors.push({
      table,
      message: `${orphanedCount} rows still missing tenant_id after assignment`,
    });
    console.error(`[tenant]   ✗ ${table}: ${orphanedCount} rows without tenant_id`);
  }
  if (errors.length === 0) {
    console.log(`[tenant]   ✓ All rows in mapped targets have tenant_id assigned`);
  }

  return { tables, assigned, errors };
}

/**
 * Executes the tenant assignment for all migrated data.
 */
export async function assignTenant(config: MigrationConfig): Promise<MigrationStepResult> {
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

    // Step 1: Ensure default tenant exists
    console.log(`[tenant] Ensuring default tenant: "${config.defaultTenantName}"`);
    const tenantId = await ensureDefaultTenant(
      client,
      config.pg.schema,
      config.defaultTenantName,
      config.defaultTenantSlug,
    );
    console.log(`[tenant] Default tenant ID: ${tenantId}`);

    // Steps 2–3: assign + verify over the TABLE_MAPPINGS targets (PRC-M554).
    const outcome = await assignAndVerifyTenant(client, config.pg.schema, tenantId);
    tablesProcessed = outcome.assigned.length;
    rowsProcessed = outcome.assigned.reduce((sum, a) => sum + a.count, 0);
    errors.push(...outcome.errors);

    // PRC-M554: do not COMMIT a partial/failed assignment. Roll back instead.
    if (errors.length > 0) {
      await client.query('ROLLBACK');
      return {
        step: 'tenant-assignment',
        status: 'error',
        tablesProcessed,
        rowsProcessed,
        errors,
        warnings,
        durationMs: Date.now() - startTime,
      };
    }

    // Store the tenant ID in the mapping table for reference
    await client.query(
      `INSERT INTO ${MIGRATION_UUID_MAP_TABLE} (legacy_table, legacy_id, new_uuid)
       VALUES ('_default_tenant', 0, $1::uuid)
       ON CONFLICT (legacy_table, legacy_id) DO UPDATE SET new_uuid = $1::uuid`,
      [tenantId],
    );

    await client.query('COMMIT');

    return {
      step: 'tenant-assignment',
      status: 'success',
      tablesProcessed,
      rowsProcessed,
      errors,
      warnings,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ table: 'all', message: `Tenant assignment transaction failed: ${message}` });

    return {
      step: 'tenant-assignment',
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
