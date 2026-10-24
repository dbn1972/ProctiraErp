/**
 * PRC-M207 — live Postgres red-then-green proof that staff_payroll_runs
 * cannot double-post the same (tenant_id, month).
 *
 * Before db/sql/246: db/sql/083 dropped the plain UNIQUE (tenant_id, month)
 * (to let a reversal + replacement coexist with the original posted row) and
 * never replaced it with anything scoped to status='posted', so two
 * concurrent "post payroll for this month" INSERTs for the same tenant+month
 * both succeed.
 * After 246: the second status='posted' INSERT for the same (tenant_id,
 * month) fails with 23505, while a 'reversal' row for the same month is not
 * blocked by the partial index.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 083.
 * Optional MIGRATOR_DATABASE_URL (table-owning role) is used to drop/restore
 * 246's index for the red phase; when unset, the red phase is skipped.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'payroll-posted-once-per-month.live.test',
});
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL'];

const MIGRATION_246 = '246_payroll_posted_once_per_month.sql';
const INDEX_NAME = 'staff_payroll_runs_posted_once_uidx';

// 246 contains CREATE INDEX CONCURRENTLY, which cannot run inside a
// transaction block. node-postgres's simple query protocol implicitly wraps
// a multi-statement query string in one transaction, so the file must be
// applied via a separate psql process (mirroring apply-sql.sh's own
// non-txn/CONCURRENTLY file handling) rather than pool.query().
function apply246(): void {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  execFileSync(
    'psql',
    [
      MIGRATOR_DATABASE_URL!,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-f',
      path.join(root, 'db/sql', MIGRATION_246),
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
}

describe.skipIf(!DATABASE_URL)('PRC-M207 payroll posted-once-per-month (live)', () => {
  let pool: pg.Pool;
  let migrator: pg.Pool | undefined;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    if (MIGRATOR_DATABASE_URL) {
      migrator = new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL });
    }
  });

  afterAll(async () => {
    await pool.end();
    await migrator?.end();
  });

  function insertPostedRun(client: pg.PoolClient, tenantId: string, month: string) {
    return client.query(
      `INSERT INTO staff_payroll_runs (
         id, tenant_id, month, status, gross_cents, deductions_cents, net_cents
       ) VALUES ($1, $2, $3, 'posted', 10000, 1000, 9000)`,
      [randomUUID(), tenantId, month],
    );
  }

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    'RED: without the index, two posted runs for the same tenant+month both insert',
    async () => {
      const m = migrator!;
      try {
        await m.query(`DROP INDEX IF EXISTS public.${INDEX_NAME}`);

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const tenantId = randomUUID();
          await ensurePgTestTenant(pool, tenantId);
          await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

          // The bug: both inserts for the same (tenant_id, month) succeed.
          await insertPostedRun(client, tenantId, '2026-02');
          await insertPostedRun(client, tenantId, '2026-02');

          const { rows } = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM staff_payroll_runs
             WHERE tenant_id = $1 AND month = '2026-02' AND status = 'posted'`,
            [tenantId],
          );
          expect(rows[0]!.count).toBe('2');

          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      } finally {
        apply246();
      }
    },
  );

  it('GREEN: a second posted run for the same tenant+month fails with 23505', async () => {
    if (migrator) apply246();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tenantId = randomUUID();
      await ensurePgTestTenant(pool, tenantId);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      await insertPostedRun(client, tenantId, '2026-03');

      await client.query('SAVEPOINT sp_dup');
      await expect(insertPostedRun(client, tenantId, '2026-03')).rejects.toMatchObject({
        code: '23505',
      });
      await client.query('ROLLBACK TO SAVEPOINT sp_dup');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: a reversal row for the same month is not blocked by the partial index', async () => {
    if (migrator) apply246();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tenantId = randomUUID();
      await ensurePgTestTenant(pool, tenantId);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      const postedId = randomUUID();
      await client.query(
        `INSERT INTO staff_payroll_runs (
           id, tenant_id, month, status, gross_cents, deductions_cents, net_cents
         ) VALUES ($1, $2, '2026-04', 'posted', 10000, 1000, 9000)`,
        [postedId, tenantId],
      );

      // A reversal row for the same (tenant_id, month) is not covered by the
      // partial index (WHERE status = 'posted') and inserts fine.
      await client.query(
        `INSERT INTO staff_payroll_runs (
           id, tenant_id, month, status, gross_cents, deductions_cents, net_cents, reverses_run_id
         ) VALUES ($1, $2, '2026-04', 'reversal', 10000, 1000, 9000, $3)`,
        [randomUUID(), tenantId, postedId],
      );

      // A replacement posted run for the same month (after reversing the
      // original) is also not blocked once the original posted row's
      // uniqueness slot is vacated... but the original posted row still
      // exists here (083 never deletes it), so a NEW posted row for the same
      // month while the first is still 'posted' is correctly still rejected.
      await client.query('SAVEPOINT sp_still_blocked');
      await expect(
        client.query(
          `INSERT INTO staff_payroll_runs (
             id, tenant_id, month, status, gross_cents, deductions_cents, net_cents
           ) VALUES ($1, $2, '2026-04', 'posted', 10000, 1000, 9000)`,
          [randomUUID(), tenantId],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await client.query('ROLLBACK TO SAVEPOINT sp_still_blocked');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
