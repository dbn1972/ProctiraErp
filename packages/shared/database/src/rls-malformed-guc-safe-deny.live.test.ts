/**
 * PRC-L294 — live Postgres red-then-green proof that the 9 residual
 * malformed-GUC-raising tenant_isolation policies now deny instead of raise.
 *
 * Before db/sql/240: `tenant_id = (NULLIF(current_setting('app.tenant_id',
 * true), ''))::uuid` raises 22P02 (invalid input syntax for type uuid) when
 * `app.tenant_id` is bound to a non-UUID string.
 * After 240: `tenant_id::text = NULLIF(current_setting('app.tenant_id',
 * true), '')` instead returns zero rows for the same malformed GUC.
 *
 * Requires DATABASE_URL as proctira_app. Optional MIGRATOR_DATABASE_URL
 * (table-owning role) is used to apply/un-apply 240 for the red phase; when
 * unset, the red phase is skipped and only the green (post-240) behavior is
 * asserted — 240 is expected to already be applied on DATABASE_URL in that
 * case.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'rls-malformed-guc-safe-deny.live.test',
});
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL'];

const MIGRATION_240 = '240_rls_malformed_guc_safe_deny.sql';

// Spans different FOR-clause shapes: fee_credit_notes is FOR ALL with USING
// only; fee_reminder_send_audits and student_merges are FOR ALL with both
// USING and WITH CHECK.
const PROBE_TABLES = ['fee_credit_notes', 'fee_reminder_send_audits', 'student_merges'] as const;

const PRE_240_POLICY_SQL: Record<(typeof PROBE_TABLES)[number], string> = {
  fee_credit_notes: `
    DROP POLICY IF EXISTS tenant_isolation ON fee_credit_notes;
    CREATE POLICY tenant_isolation ON fee_credit_notes AS PERMISSIVE FOR ALL TO PUBLIC
      USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
  `,
  fee_reminder_send_audits: `
    DROP POLICY IF EXISTS fee_reminder_send_audits_tenant ON fee_reminder_send_audits;
    CREATE POLICY fee_reminder_send_audits_tenant ON fee_reminder_send_audits
      AS PERMISSIVE FOR ALL TO PUBLIC
      USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
      WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
  `,
  student_merges: `
    DROP POLICY IF EXISTS tenant_isolation ON student_merges;
    CREATE POLICY tenant_isolation ON student_merges AS PERMISSIVE FOR ALL TO PUBLIC
      USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
      WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
  `,
};

function load240(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  return readFileSync(path.join(root, 'db/sql', MIGRATION_240), 'utf8');
}

describe.skipIf(!DATABASE_URL)('PRC-L294 RLS malformed-GUC safe-deny (live)', () => {
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

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    'RED: pre-240 policy shape raises 22P02 on a malformed tenant GUC',
    async () => {
      const m = migrator!;
      try {
        for (const table of PROBE_TABLES) {
          await m.query(PRE_240_POLICY_SQL[table]);
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(`SELECT set_config('app.tenant_id', 'not-a-uuid', true)`);
          for (const [idx, table] of PROBE_TABLES.entries()) {
            // Each probe gets its own savepoint: once a query raises, the
            // surrounding transaction aborts and every later statement in it
            // reports a generic "current transaction is aborted" instead of
            // the real error, masking the other tables' results.
            await client.query(`SAVEPOINT sp_red_${idx}`);
            await expect(client.query(`SELECT 1 FROM ${table} LIMIT 1`)).rejects.toThrow(
              /invalid input syntax for type uuid/i,
            );
            await client.query(`ROLLBACK TO SAVEPOINT sp_red_${idx}`);
          }
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      } finally {
        // Restore the safe-deny shape so GREEN below is unaffected by RED's
        // teardown ordering even if a later assertion throws.
        await m.query(load240());
      }
    },
  );

  it('GREEN: post-240 policy denies (zero rows) instead of raising on a malformed tenant GUC', async () => {
    if (migrator) {
      // Ensure 240 is applied (idempotent) even if RED above was skipped.
      await migrator.query(load240());
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', 'not-a-uuid', true)`);
      for (const table of PROBE_TABLES) {
        const { rows } = await client.query(`SELECT 1 FROM ${table} LIMIT 1`);
        expect(rows, `${table} should deny (zero rows) on malformed GUC`).toHaveLength(0);
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: post-240 policy also denies on a missing tenant GUC (no set_config at all)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Deliberately do not set app.tenant_id at all.
      for (const table of PROBE_TABLES) {
        const { rows } = await client.query(`SELECT 1 FROM ${table} LIMIT 1`);
        expect(rows, `${table} should deny (zero rows) with no GUC bound`).toHaveLength(0);
      }
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('catalog has no leftover ::uuid-cast tenant_isolation policy on the 9 named tables', async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN (
            'fee_credit_notes', 'fee_write_offs', 'staff_payroll_ledger_entries',
            'staff_payroll_lines', 'staff_payroll_runs', 'fee_reminder_send_audits',
            'fee_reminder_suppressions', 'student_admission_counters', 'student_merges'
          )
          AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%::uuid%'`,
    );
    expect(rows[0]!.count).toBe('0');
  });
});
