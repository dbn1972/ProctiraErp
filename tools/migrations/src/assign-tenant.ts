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

import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { loadConfig } from './config.js';
import { MigrationConfig, MigrationStepResult } from './types.js';

/** Tables that require tenant_id assignment. */
const TENANT_SCOPED_TABLES = [
  'geographic_areas',
  'institutions',
  'students',
  'staff',
  'enrollments',
  'academic_periods',
  'grades',
  'classes',
  'subjects',
  'institution_subjects',
] as const;

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
  const existing = await client.query(
    `SELECT id FROM "${targetSchema}"."tenants" WHERE slug = $1`,
    [tenantSlug],
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
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
  client: PoolClient,
  targetSchema: string,
  table: string,
  tenantId: string,
): Promise<number> {
  // Only update rows that don't already have a tenant_id
  const result = await client.query(
    `UPDATE "${targetSchema}"."${table}"
     SET tenant_id = $1
     WHERE tenant_id IS NULL OR tenant_id = ''`,
    [tenantId],
  );

  return result.rowCount ?? 0;
}

/**
 * Verifies that no rows in tenant-scoped tables are missing a tenant_id.
 */
async function verifyTenantAssignment(
  client: PoolClient,
  targetSchema: string,
): Promise<{ table: string; orphanedCount: number }[]> {
  const orphans: { table: string; orphanedCount: number }[] = [];

  for (const table of TENANT_SCOPED_TABLES) {
    const result = await client.query(
      `SELECT COUNT(*) as count FROM "${targetSchema}"."${table}"
       WHERE tenant_id IS NULL OR tenant_id = ''`,
    );
    const count = parseInt(result.rows[0].count, 10);
    if (count > 0) {
      orphans.push({ table, orphanedCount: count });
    }
  }

  return orphans;
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

    // Step 2: Assign tenant_id to all scoped tables
    console.log(`[tenant] Assigning tenant_id to migrated data...`);
    for (const table of TENANT_SCOPED_TABLES) {
      try {
        const count = await assignTenantToTable(client, config.pg.schema, table, tenantId);
        console.log(`[tenant]   ✓ ${table}: ${count} rows assigned`);
        tablesProcessed++;
        rowsProcessed += count;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ table, message: `Tenant assignment failed: ${message}` });
        console.error(`[tenant]   ✗ ${table}: ${message}`);
      }
    }

    // Step 3: Verify no orphaned rows
    console.log(`[tenant] Verifying tenant assignment completeness...`);
    const orphans = await verifyTenantAssignment(client, config.pg.schema);
    if (orphans.length > 0) {
      for (const { table, orphanedCount } of orphans) {
        warnings.push({
          table,
          message: `${orphanedCount} rows still missing tenant_id`,
          count: orphanedCount,
        });
        console.warn(`[tenant]   ⚠ ${table}: ${orphanedCount} rows without tenant_id`);
      }
    } else {
      console.log(`[tenant]   ✓ All rows have tenant_id assigned`);
    }

    // Store the tenant ID in the mapping table for reference
    await client.query(
      `INSERT INTO migration_uuid_map (legacy_table, legacy_id, new_uuid)
       VALUES ('_default_tenant', 0, $1::uuid)
       ON CONFLICT (legacy_table, legacy_id) DO UPDATE SET new_uuid = $1::uuid`,
      [tenantId],
    );

    await client.query('COMMIT');

    return {
      step: 'tenant-assignment',
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
