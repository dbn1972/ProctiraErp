/**
 * Test-only PostgreSQL parent fixtures for strict tenant/cross-domain FKs.
 *
 * Live repository suites run through the non-owner runtime role so RLS and
 * privileges remain real. Their parent rows still need to be provisioned
 * explicitly; these helpers do that in short, transaction-local platform
 * scopes without weakening production constraints or repository behavior.
 */
import { withPlatformScope } from './pg-document-store.js';
import type { PgPoolWithConnect, PgQueryable } from './pg-tenant.js';

export type PgTestFixtureDatabase = PgPoolWithConnect | PgQueryable;

function assertTestRuntime(): void {
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('PostgreSQL test fixtures are disabled in production');
  }
}

/** Ensure a real active tenant parent exists for a live repository test. */
export async function ensurePgTestTenant(
  database: PgTestFixtureDatabase,
  tenantId: string,
): Promise<void> {
  assertTestRuntime();
  await withPlatformScope(database, async (client) => {
    await client.query(
      `INSERT INTO tenants (id, name, slug, config, status)
       VALUES ($1::uuid, $2, $3, '{}'::jsonb, 'active')
       ON CONFLICT (id) DO UPDATE
         SET status = 'active', deleted_at = NULL, updated_at = now()`,
      [tenantId, `Test tenant ${tenantId.slice(0, 8)}`, `test-${tenantId}`],
    );
  });
}

/** Ensure a real student parent exists in the supplied tenant. */
export async function ensurePgTestStudent(
  database: PgTestFixtureDatabase,
  tenantId: string,
  studentId: string,
): Promise<void> {
  assertTestRuntime();
  await ensurePgTestTenant(database, tenantId);
  await withPlatformScope(
    database,
    async (client) => {
      await client.query(
        `INSERT INTO students
           (id, tenant_id, first_name, last_name, date_of_birth, gender, custom_data)
         VALUES ($1::uuid, $2::uuid, 'Test', 'Student', DATE '2012-01-01',
                 'unspecified', '{}'::jsonb)
         ON CONFLICT (id) DO UPDATE
           SET deleted_at = NULL, updated_at = now()
         WHERE students.tenant_id = EXCLUDED.tenant_id`,
        [studentId, tenantId],
      );
    },
    tenantId,
  );
}

/** Ensure a real staff parent exists in the supplied tenant. */
export async function ensurePgTestStaff(
  database: PgTestFixtureDatabase,
  tenantId: string,
  staffId: string,
): Promise<void> {
  assertTestRuntime();
  await ensurePgTestTenant(database, tenantId);
  await withPlatformScope(
    database,
    async (client) => {
      await client.query(
        `INSERT INTO staff
           (id, tenant_id, first_name, last_name, date_of_birth, identity_number, custom_data)
         VALUES ($1::uuid, $2::uuid, 'Test', 'Staff', DATE '1985-01-01', $3,
                 '{}'::jsonb)
         ON CONFLICT (id) DO UPDATE
           SET deleted_at = NULL, updated_at = now()
         WHERE staff.tenant_id = EXCLUDED.tenant_id`,
        [staffId, tenantId, `TEST-${staffId}`],
      );
    },
    tenantId,
  );
}
