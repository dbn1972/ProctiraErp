/**
 * W1-DATA-14 — live Postgres proofs that enrollment status / grade changes
 * cannot skip audit rows (database triggers, not application convention).
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

const MIGRATION = '071_enrollment_grade_audit_completeness.sql';

describe.skipIf(!DATABASE_URL)('W1-DATA-14 enrollment / grade audit completeness (live)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const sql = readFileSync(path.join(root, 'db/sql', MIGRATION), 'utf8');
    await pool.query(sql);
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
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, $2, 'Audit', 'Student', '2012-01-01', 'unspecified')`,
      [studentId, tenantId],
    );
    await client.query(
      `INSERT INTO enrollments (
         id, tenant_id, student_id, institution_id, grade_id, academic_period_id, status, enrolled_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'ENROLLED', CURRENT_DATE)`,
      [enrollmentId, tenantId, studentId, institutionId, gradeId, academicPeriodId],
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

      const expectAppendOnlyReject = async (label: string, sql: string, params: unknown[]) => {
        await client.query(`SAVEPOINT ${label}`);
        await expect(client.query(sql, params)).rejects.toThrow(/append-only/i);
        await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
      };

      await expectAppendOnlyReject(
        'sp_enr_upd',
        `UPDATE enrollment_history SET reason = 'tamper' WHERE enrollment_id = $1`,
        [fx.enrollmentId],
      );
      await expectAppendOnlyReject(
        'sp_enr_del',
        `DELETE FROM enrollment_history WHERE enrollment_id = $1`,
        [fx.enrollmentId],
      );
      await expectAppendOnlyReject(
        'sp_grd_upd',
        `UPDATE grade_change_audit SET action = 'tamper' WHERE grade_entry_id = $1`,
        [fx.gradeEntryId],
      );
      await expectAppendOnlyReject(
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
      ).rejects.toThrow(/foreign key|grade_change_audit_grade_entry_fk/i);
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });
});
