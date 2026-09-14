/**
 * W1-DATA-14 — live Postgres proofs that enrollment status / grade changes
 * cannot skip audit rows (database triggers), and that proctira_app cannot
 * mutate audit/history rows (append-only + REVOKE).
 *
 * Requires DATABASE_URL as proctira_app against a DB that applied through 076.
 * Optional MIGRATOR_DATABASE_URL applies 071+076 when the ledger is behind.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'enrollment-grade-audit-completeness.live.test',
});

const MIGRATIONS = [
  '071_enrollment_grade_audit_completeness.sql',
  '076_enrollment_grade_audit_harden.sql',
] as const;

const AUDIT_TRIGGERS = [
  { table: 'enrollment_history', trigger: 'trg_enrollment_history_append_only' },
  { table: 'grade_change_audit', trigger: 'trg_grade_change_audit_append_only' },
  { table: 'enrollments', trigger: 'trg_enrollments_write_history' },
  { table: 'grade_entries', trigger: 'trg_grade_entries_write_change_audit' },
] as const;

describe.skipIf(!DATABASE_URL)('W1-DATA-14 enrollment / grade audit completeness (live)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    const migratorUrl = process.env['MIGRATOR_DATABASE_URL'];
    if (migratorUrl) {
      const migrator = new pg.Pool({ connectionString: migratorUrl });
      try {
        const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
        for (const file of MIGRATIONS) {
          const sql = readFileSync(path.join(root, 'db/sql', file), 'utf8');
          await migrator.query(sql);
        }
      } finally {
        await migrator.end();
      }
    }

    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedTenantGraph(client: pg.PoolClient): Promise<{
    tenantId: string;
    studentId: string;
    institutionId: string;
    gradeId: string;
    academicPeriodId: string;
    enrollmentId: string;
    gradeEntryId: string;
  }> {
    const tenantId = randomUUID();
    const areaId = randomUUID();
    const institutionId = randomUUID();
    const academicPeriodId = randomUUID();
    const gradeId = randomUUID();
    const classId = randomUUID();
    const studentId = randomUUID();
    const enrollmentId = randomUUID();
    const gradeEntryId = randomUUID();
    const suffix = tenantId.slice(0, 8);

    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(`SELECT set_config('app.platform_admin', '1', true)`);

    await client.query(
      `INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, `audit-complete-${suffix}`, `audit-complete-${suffix}`],
    );
    await client.query(
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, 'Root', 'ROOT', 0, NULL, '/', 1, 2)`,
      [areaId, tenantId],
    );
    await client.query(
      `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
       VALUES ($1, $2, 'Audit School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
      [institutionId, tenantId, `AUD-${suffix}`, areaId],
    );
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       VALUES ($1, $2, 'AY', $3, '2026-04-01', '2027-03-31', 'active')`,
      [academicPeriodId, tenantId, `AY-${suffix}`],
    );
    await client.query(
      `INSERT INTO grades (id, tenant_id, name, code, "order")
       VALUES ($1, $2, 'Grade 6', $3, 6)`,
      [gradeId, tenantId, `G6-${suffix}`],
    );
    await client.query(
      `INSERT INTO classes (
         id, tenant_id, institution_id, grade_id, academic_period_id, name
       ) VALUES ($1, $2, $3, $4, $5, '6A')`,
      [classId, tenantId, institutionId, gradeId, academicPeriodId],
    );
    await client.query(
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, $2, 'Audit', 'Student', '2012-01-01', 'unspecified')`,
      [studentId, tenantId],
    );
    await client.query(
      `INSERT INTO enrollments (
         id, tenant_id, student_id, institution_id, grade_id, class_id,
         academic_period_id, status, enrolled_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ENROLLED', CURRENT_DATE)`,
      [
        enrollmentId,
        tenantId,
        studentId,
        institutionId,
        gradeId,
        classId,
        academicPeriodId,
      ],
    );
    await client.query(
      `INSERT INTO grade_entries (
         id, tenant_id, student_id, numeric_score, letter_grade, metadata
       ) VALUES ($1, $2, $3, 80, 'B', '{"workflowStatus":"DRAFT"}'::jsonb)`,
      [gradeEntryId, tenantId, studentId],
    );

    return {
      tenantId,
      studentId,
      institutionId,
      gradeId,
      academicPeriodId,
      enrollmentId,
      gradeEntryId,
    };
  }

  it('DATABASE_URL connects as non-owner proctira_app', async () => {
    const { rows } = await pool.query<{ current_user: string; rolsuper: boolean }>(`
      SELECT
        current_user,
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper
    `);
    expect(rows[0]!.current_user).toBe('proctira_app');
    expect(rows[0]!.rolsuper).toBe(false);
  });

  it('runtime has SELECT/INSERT but not UPDATE/DELETE/TRUNCATE/TRIGGER on audit tables', async () => {
    for (const table of ['enrollment_history', 'grade_change_audit'] as const) {
      const { rows } = await pool.query<{
        sel: boolean;
        ins: boolean;
        upd: boolean;
        del: boolean;
        trunc: boolean;
        trig: boolean;
      }>(
        `SELECT
           has_table_privilege(current_user, $1, 'SELECT') AS sel,
           has_table_privilege(current_user, $1, 'INSERT') AS ins,
           has_table_privilege(current_user, $1, 'UPDATE') AS upd,
           has_table_privilege(current_user, $1, 'DELETE') AS del,
           has_table_privilege(current_user, $1, 'TRUNCATE') AS trunc,
           has_table_privilege(current_user, $1, 'TRIGGER') AS trig`,
        [table],
      );
      expect(rows[0]!.sel, `${table} SELECT`).toBe(true);
      expect(rows[0]!.ins, `${table} INSERT`).toBe(true);
      expect(rows[0]!.upd, `${table} UPDATE`).toBe(false);
      expect(rows[0]!.del, `${table} DELETE`).toBe(false);
      expect(rows[0]!.trunc, `${table} TRUNCATE`).toBe(false);
      expect(rows[0]!.trig, `${table} TRIGGER`).toBe(false);
    }
  });

  it('runtime cannot DROP audit completeness triggers', async () => {
    for (const { table, trigger } of AUDIT_TRIGGERS) {
      await expect(pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`)).rejects.toThrow(
        /must be owner|permission denied/i,
      );
    }
  });

  it('enrollment INSERT writes enrollment_history without app INSERT', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fx = await seedTenantGraph(client);
      const { rows } = await client.query<{
        new_status: string;
        previous_status: string | null;
        reason: string | null;
      }>(
        `SELECT previous_status, new_status, reason FROM enrollment_history
         WHERE enrollment_id = $1 ORDER BY created_at ASC`,
        [fx.enrollmentId],
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0]!.previous_status).toBeNull();
      expect(rows[0]!.new_status).toBe('ENROLLED');
      expect(String(rows[0]!.reason ?? '')).toMatch(/database trigger|Initial enrollment/i);
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('raw enrollment status UPDATE writes history (app can skip createHistoryEntry)', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fx = await seedTenantGraph(client);
      await client.query(
        `UPDATE enrollments SET status = 'WITHDRAWN', exited_at = CURRENT_DATE, updated_at = NOW()
         WHERE id = $1`,
        [fx.enrollmentId],
      );
      const { rows } = await client.query<{ new_status: string; previous_status: string | null }>(
        `SELECT previous_status, new_status FROM enrollment_history
         WHERE enrollment_id = $1 AND new_status = 'WITHDRAWN'
         ORDER BY created_at DESC LIMIT 1`,
        [fx.enrollmentId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.previous_status).toBe('ENROLLED');
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('raw grade score UPDATE writes grade_change_audit without app appendAudit', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fx = await seedTenantGraph(client);
      await client.query(
        `UPDATE grade_entries SET numeric_score = 95, letter_grade = 'A', updated_at = NOW()
         WHERE id = $1`,
        [fx.gradeEntryId],
      );
      const { rows } = await client.query<{
        action: string;
        from_numeric_score: string | null;
        to_numeric_score: string | null;
      }>(
        `SELECT action, from_numeric_score::text, to_numeric_score::text
         FROM grade_change_audit
         WHERE grade_entry_id = $1
         ORDER BY created_at DESC`,
        [fx.gradeEntryId],
      );
      expect(rows.length).toBeGreaterThanOrEqual(2); // insert + score change
      const scoreChange = rows.find((r) => r.action === 'grade.score_change');
      expect(scoreChange).toBeDefined();
      expect(Number(scoreChange!.from_numeric_score)).toBe(80);
      expect(Number(scoreChange!.to_numeric_score)).toBe(95);
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('rejects UPDATE/DELETE on enrollment_history and grade_change_audit', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fx = await seedTenantGraph(client);

      const expectMutateReject = async (label: string, sql: string, params: unknown[]) => {
        await client.query(`SAVEPOINT ${label}`);
        await expect(client.query(sql, params)).rejects.toThrow(
          /append-only|permission denied/i,
        );
        await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
      };

      await expectMutateReject(
        'sp_enr_upd',
        `UPDATE enrollment_history SET reason = 'tamper' WHERE enrollment_id = $1`,
        [fx.enrollmentId],
      );
      await expectMutateReject(
        'sp_enr_del',
        `DELETE FROM enrollment_history WHERE enrollment_id = $1`,
        [fx.enrollmentId],
      );
      await expectMutateReject(
        'sp_grd_upd',
        `UPDATE grade_change_audit SET action = 'tamper' WHERE grade_entry_id = $1`,
        [fx.gradeEntryId],
      );
      await expectMutateReject(
        'sp_grd_del',
        `DELETE FROM grade_change_audit WHERE grade_entry_id = $1`,
        [fx.gradeEntryId],
      );

      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('RESTRICT FK blocks parent DELETE while audit/history rows exist', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fx = await seedTenantGraph(client);

      await client.query(`SAVEPOINT sp_del_enr`);
      await expect(
        client.query(`DELETE FROM enrollments WHERE id = $1`, [fx.enrollmentId]),
      ).rejects.toThrow(/foreign key|restrict|violates|append-only/i);
      await client.query(`ROLLBACK TO SAVEPOINT sp_del_enr`);

      await client.query(`SAVEPOINT sp_del_ge`);
      await expect(
        client.query(`DELETE FROM grade_entries WHERE id = $1`, [fx.gradeEntryId]),
      ).rejects.toThrow(/foreign key|restrict|violates|append-only/i);
      await client.query(`ROLLBACK TO SAVEPOINT sp_del_ge`);

      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('grade_change_audit FK rejects orphan grade_entry_id', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fx = await seedTenantGraph(client);
      await expect(
        client.query(
          `INSERT INTO grade_change_audit (
             tenant_id, grade_entry_id, action, details
           ) VALUES ($1, $2, 'orphan', '{}'::jsonb)`,
          [fx.tenantId, randomUUID()],
        ),
      ).rejects.toThrow(/foreign key|grade_change_audit_grade_entry/i);
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
});
