/**
 * PRC-M216 — live proof that the 087 FKs are validated and the 086/093 FKs
 * were re-proven with FORCE ROW LEVEL SECURITY lifted (db/sql/257).
 *
 * Before 257: the six 087 constraints are NOT VALID (convalidated = false) and
 * 257 is absent from schema_migrations (RED). After: all six are validated,
 * 257 is ledgered, and FORCE RLS is back on every table 257 touched (GREEN).
 */
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'force-rls-fk-revalidation.live.test' });

const FKS_087 = [
  'assessment_results_student_id_fkey',
  'examination_academic_records_student_id_fkey',
  'examination_candidate_registrations_student_id_fkey',
  'examination_candidates_student_id_fkey',
  'staff_attendance_staff_id_fkey',
  'student_attendance_student_id_fkey',
];

const FKS_086_093 = [
  'developer_portal_webhook_deliveries_tenant_fk',
  'developer_portal_webhooks_tenant_fk',
  'staff_contracts_staff_id_fkey',
  'transport_fee_structures_fees_structure_id_fkey',
];

describe.skipIf(!DATABASE_URL)('FORCE-RLS FK re-validation (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('the six 087 constraints are validated', async () => {
    const { rows } = await pool.query<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint
        WHERE contype = 'f' AND conname = ANY ($1::text[])
        ORDER BY conname`,
      [FKS_087],
    );
    expect(rows).toEqual(FKS_087.map((conname) => ({ conname, convalidated: true })));
  });

  it('the 086/093 constraints stay validated', async () => {
    const { rows } = await pool.query<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint
        WHERE contype = 'f' AND conname = ANY ($1::text[])
        ORDER BY conname`,
      [FKS_086_093],
    );
    expect(rows).toEqual(FKS_086_093.map((conname) => ({ conname, convalidated: true })));
  });

  it('257_revalidate_force_rls_fks.sql is recorded in schema_migrations', async () => {
    // Runtime roles cannot read schema_migrations; the readiness helper can.
    const { rows } = await pool.query<{ migration_name: string; migration_applied: boolean }>(
      `SELECT migration_name, migration_applied
         FROM public.proctira_runtime_migration_status($1::text[])`,
      [['257_revalidate_force_rls_fks.sql']],
    );
    expect(rows).toEqual([
      { migration_name: '257_revalidate_force_rls_fks.sql', migration_applied: true },
    ]);
  });

  it('FORCE ROW LEVEL SECURITY is still on for every child and parent touched', async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT DISTINCT t.relname
         FROM pg_constraint c
         JOIN pg_class t ON t.oid IN (c.conrelid, c.confrelid)
        WHERE c.contype = 'f' AND c.conname = ANY ($1::text[])
          AND t.relrowsecurity AND NOT t.relforcerowsecurity
        ORDER BY 1`,
      [[...FKS_087, ...FKS_086_093]],
    );
    expect(rows).toEqual([]);
  });
});
