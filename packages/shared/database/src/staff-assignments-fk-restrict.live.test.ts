/**
 * PRC-L297 — live Postgres proof that a staff hard delete no longer cascades
 * into staff_assignments (db/sql/309), and that staff user lookups no longer
 * rely on the tenant-less staff_user_id_idx.
 *
 * Before 309 both staff FKs on staff_assignments were ON DELETE CASCADE, so
 * `DELETE FROM staff` silently removed the assignments that authorization
 * reads. After 309 the delete fails with 23503 and the assignment survives.
 *
 * Needs DATABASE_URL (proctira_app) and MIGRATOR_DATABASE_URL (owner, used for
 * the fixture rows under FORCE RLS). Every write runs in a rolled-back
 * transaction.
 */
import { randomUUID } from 'node:crypto';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensurePgTestTenant } from './test-fixtures.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'staff-assignments-fk-restrict.live.test' });
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL']?.trim();
const live = Boolean(DATABASE_URL && MIGRATOR_DATABASE_URL);

const TENANT = randomUUID();

describe.skipIf(!live)('PRC-L297 staff_assignments FK RESTRICT (live)', () => {
  let owner: pg.Pool;
  let app: pg.Pool;

  beforeAll(async () => {
    owner = new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL, max: 2 });
    app = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    await ensurePgTestTenant(owner, TENANT);
  });

  afterAll(async () => {
    await app?.end();
    await owner?.end();
  });

  /** Seed area, institution, staff and one assignment inside an open transaction. */
  async function seed(client: pg.PoolClient): Promise<{ staffId: string; assignmentId: string }> {
    const area = randomUUID();
    const school = randomUUID();
    const staffId = randomUUID();
    const assignmentId = randomUUID();
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT]);
    await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [TENANT]);
    await client.query(
      `INSERT INTO geographic_areas
         (id, tenant_id, name, code, level, path, lft, rgt, created_at, updated_at)
       VALUES ($1, $2, 'L297 District', $3, 0, '/l297', 1, 2, now(), now())`,
      [area, TENANT, `AREA-${area.slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO institutions
         (id, tenant_id, name, code, area_id, type, sector, ownership, created_at, updated_at)
       VALUES ($1, $2, 'L297 School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', now(), now())`,
      [school, TENANT, `SCH-${school.slice(0, 8)}`, area],
    );
    await client.query(
      `INSERT INTO staff
         (id, tenant_id, first_name, last_name, date_of_birth, identity_number,
          user_id, created_at, updated_at)
       VALUES ($1, $2, 'Lee', 'Teacher', '1985-01-01', $3, $4, now(), now())`,
      [staffId, TENANT, `IDN-${staffId.slice(0, 8)}`, randomUUID()],
    );
    await client.query(
      `INSERT INTO staff_assignments
         (id, tenant_id, staff_id, institution_id, role, allocation_percentage,
          start_date, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'teacher', 50, DATE '2026-04-01', 'ACTIVE', now(), now())`,
      [assignmentId, TENANT, staffId, school],
    );
    return { staffId, assignmentId };
  }

  it('a staff hard delete with assignments is rejected and the assignment survives', async () => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      const { staffId, assignmentId } = await seed(client);
      await client.query('SAVEPOINT del');
      const err = await client.query('DELETE FROM staff WHERE id = $1', [staffId]).then(
        () => null,
        (e: { code?: string }) => e,
      );
      await client.query('ROLLBACK TO SAVEPOINT del');
      expect(err?.code, 'expected 23503 foreign_key_violation, not a cascade').toBe('23503');
      const { rows } = await client.query('SELECT 1 FROM staff_assignments WHERE id = $1', [
        assignmentId,
      ]);
      expect(rows).toHaveLength(1);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('after the assignment is removed the staff row can be deleted', async () => {
    const client = await owner.connect();
    try {
      await client.query('BEGIN');
      const { staffId, assignmentId } = await seed(client);
      await client.query('DELETE FROM staff_assignments WHERE id = $1', [assignmentId]);
      const res = await client.query('DELETE FROM staff WHERE id = $1', [staffId]);
      expect(res.rowCount).toBe(1);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('both staff FKs are validated ON DELETE RESTRICT and FORCE RLS stays on', async () => {
    const { rows } = await app.query<{ conname: string; deltype: string; validated: boolean }>(
      `SELECT conname, confdeltype::text AS deltype, convalidated AS validated
         FROM pg_constraint
        WHERE conrelid = 'public.staff_assignments'::regclass
          AND contype = 'f' AND confrelid = 'public.staff'::regclass
        ORDER BY conname`,
    );
    expect(rows).toEqual([
      { conname: 'staff_assignments_staff_fk', deltype: 'r', validated: true },
      { conname: 'staff_assignments_staff_id_tenant_fk', deltype: 'r', validated: true },
    ]);
    const forced = await app.query<{ relname: string; f: boolean }>(
      `SELECT relname, relrowsecurity AND relforcerowsecurity AS f
         FROM pg_class WHERE oid IN ('public.staff'::regclass, 'public.staff_assignments'::regclass)
        ORDER BY relname`,
    );
    expect(forced.rows).toEqual([
      { relname: 'staff', f: true },
      { relname: 'staff_assignments', f: true },
    ]);
  });

  it('staff user lookups use the tenant-leading index; staff_user_id_idx is gone', async () => {
    const idx = await app.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'staff'
          AND indexname IN ('staff_user_id_idx', 'uq_staff_user_id_per_tenant')
        ORDER BY indexname`,
    );
    expect(idx.rows.map((r) => r.indexname)).toEqual(['uq_staff_user_id_per_tenant']);

    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT]);
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (COSTS OFF) SELECT id FROM staff WHERE tenant_id = $1 AND user_id = $2`,
        [TENANT, randomUUID()],
      );
      expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/uq_staff_user_id_per_tenant/);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
