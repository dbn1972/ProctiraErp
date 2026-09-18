import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { DATABASE_SCHEMA_CONTRACTS } from './schema-contracts.js';
import {
  assertDatabaseSchemaReady,
  DatabaseSchemaNotReadyError,
  REQUIRED_RUNTIME_MIGRATIONS,
} from './schema-readiness.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'schema-readiness.live.test' });

describe.skipIf(!DATABASE_URL)('UP-P0-02 runtime schema readiness (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('validates every centralized adapter contract as the non-owner runtime role', async () => {
    const role = await pool.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      owned_tables: string;
    }>(`
      SELECT current_user,
             role.rolsuper,
             role.rolbypassrls,
             (
               SELECT count(*)::text
                 FROM pg_class AS relation
                 JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
                WHERE namespace.nspname = 'public'
                  AND relation.relkind IN ('r', 'p')
                  AND relation.relowner = role.oid
             ) AS owned_tables
        FROM pg_roles AS role
       WHERE role.rolname = current_user
    `);
    expect(role.rows[0]).toMatchObject({
      current_user: 'proctira_app',
      rolsuper: false,
      rolbypassrls: false,
      owned_tables: '0',
    });

    for (const [domain, relations] of Object.entries(DATABASE_SCHEMA_CONTRACTS)) {
      await expect(
        assertDatabaseSchemaReady(pool, domain, relations),
        `${domain} schema contract`,
      ).resolves.toBeUndefined();
    }
  });

  it('fails clearly when a required migration marker is absent', async () => {
    const missingMigration = '999_missing_runtime_contract.sql';
    await expect(
      assertDatabaseSchemaReady(
        pool,
        'missing migration drill',
        ['public.tenants'],
        [missingMigration],
      ),
    ).rejects.toMatchObject({
      missingRelations: [],
      missingMigrations: [missingMigration],
    } satisfies Partial<DatabaseSchemaNotReadyError>);
  });

  it('keeps public-schema DDL denied for the runtime role', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await expect(
        client.query('CREATE TABLE public.runtime_role_ddl_must_fail (id integer)'),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('requires the strict-FK repair and current schema marker', () => {
    expect(REQUIRED_RUNTIME_MIGRATIONS).toContain('082_repair_strict_tenant_fk_validate.sql');
    expect(REQUIRED_RUNTIME_MIGRATIONS).toContain('092_hostel_assignment_uniqueness.sql');
    expect(REQUIRED_RUNTIME_MIGRATIONS.at(-1)).toBe('095_w1_data_02_rls_safe_deny.sql');
  });
});
