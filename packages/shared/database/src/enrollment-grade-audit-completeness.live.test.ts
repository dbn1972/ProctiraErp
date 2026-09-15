/**
 * W1-DATA-14 — live Postgres proofs that database triggers are the sole audit
 * authority for enrollment status and material grade changes.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 092.
 * Optional MIGRATOR_DATABASE_URL applies 071/080/092 and enables the legacy
 * orphan quarantine rehearsal.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'enrollment-grade-audit-completeness.live.test',
});
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL'];

const MIGRATIONS = [
  '071_enrollment_grade_audit_completeness.sql',
  '080_enrollment_grade_audit_harden.sql',
  '092_w1_data_14_audit_fk_integrity.sql',
] as const;

const AUDIT_TRIGGERS = [
  { table: 'enrollment_history', trigger: 'trg_enrollment_history_append_only' },
  { table: 'grade_change_audit', trigger: 'trg_grade_change_audit_append_only' },
  { table: 'enrollments', trigger: 'trg_enrollments_write_history' },
  { table: 'grade_entries', trigger: 'trg_grade_entries_write_change_audit' },
] as const;

function loadMigration(file: (typeof MIGRATIONS)[number]): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  return readFileSync(path.join(root, 'db/sql', file), 'utf8');
}

type SeedOptions = {
  enrollmentReason?: string;
  enrollmentEffectiveDate?: string;
  gradeAction?: string;
  gradeActorId?: string;
};

describe.skipIf(!DATABASE_URL)('W1-DATA-14 enrollment / grade audit completeness (live)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    if (MIGRATOR_DATABASE_URL) {
      const migrator = new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL });
      try {
        for (const file of MIGRATIONS) {
          await migrator.query(loadMigration(file));
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

  async function seedTenantGraph(
    client: pg.PoolClient,
    options: SeedOptions = {},
  ): Promise<{
    tenantId: string;
    studentId: string;
    institutionId: string;
    gradeId: string;
    academicPeriodId: string;
    enrollmentId: string;
    gradeEntryId: string;
    enrollmentReason: string;
    gradeActorId: string;
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
    const enrollmentReason = options.enrollmentReason ?? 'Initial enrollment live proof';
    const enrollmentEffectiveDate = options.enrollmentEffectiveDate ?? '2026-04-01';
    const gradeAction = options.gradeAction ?? 'grade.insert';
    const gradeActorId = options.gradeActorId ?? randomUUID();
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

    await client.query(`SELECT set_config('app.enrollment_history_reason', $1, true)`, [
      enrollmentReason,
    ]);
    await client.query(
      `SELECT set_config('app.enrollment_history_effective_date', $1, true)`,
      [enrollmentEffectiveDate],
    );
    await client.query(
      `INSERT INTO enrollments (
         id, tenant_id, student_id, institution_id, grade_id, class_id,
         academic_period_id, status, enrolled_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ENROLLED', $8::date)`,
      [
        enrollmentId,
        tenantId,
        studentId,
        institutionId,
        gradeId,
        classId,
        academicPeriodId,
        enrollmentEffectiveDate,
      ],
    );

    await client.query(`SELECT set_config('app.grade_change_action', $1, true)`, [gradeAction]);
    await client.query(`SELECT set_config('app.grade_change_actor_id', $1, true)`, [
      gradeActorId,
    ]);
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
      enrollmentReason,
      gradeActorId,
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

  it('runtime can read but cannot directly INSERT or mutate trigger-owned audit tables', async () => {
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
      expect(rows[0]!.ins, `${table} INSERT`).toBe(false);
      expect(rows[0]!.upd, `${table} UPDATE`).toBe(false);
      expect(rows[0]!.del, `${table} DELETE`).toBe(false);
      expect(rows[0]!.trunc, `${table} TRUNCATE`).toBe(false);
      expect(rows[0]!.trig, `${table} TRIGGER`).toBe(false);
    }

    await expect(
      pool.query(`SELECT 1 FROM grade_change_audit_orphan_quarantine LIMIT 1`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('runtime cannot DROP audit completeness triggers', async () => {
    for (const { table, trigger } of AUDIT_TRIGGERS) {
      await expect(pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`)).rejects.toThrow(
        /must be owner|permission denied/i,
      );
    }
  });

  it('enrollment INSERT writes exactly one attributed initial history event', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fx = await seedTenantGraph(client, {
        enrollmentReason: 'Registrar admitted student',
        enrollmentEffectiveDate: '2026-04-03',
      });
      const { rows } = await client.query<{
        new_status: string;
        previous_status: string | null;
        reason: string | null;
        effective_date: string;
      }>(
        `SELECT previous_status, new_status, reason, effective_date::text
         FROM enrollment_history
         WHERE enrollment_id = $1
         ORDER BY created_at ASC, id ASC`,
        [fx.enrollmentId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        previous_status: null,
        new_status: 'ENROLLED',
        reason: 'Registrar admitted student',
        effective_date: '2026-04-03',
      });
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('each enrollment status UPDATE writes exactly one attributed history event', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fx = await seedTenantGraph(client);
      await client.query(`SELECT set_config('app.enrollment_history_reason', $1, true)`, [
        'Family relocated',
      ]);
      await client.query(
        `SELECT set_config('app.enrollment_history_effective_date', '2026-08-31', true)`,
      );
      await client.query(
        `UPDATE enrollments
         SET status = 'WITHDRAWN', exited_at = '2026-08-31'::date, updated_at = NOW()
         WHERE id = $1`,
        [fx.enrollmentId],
      );
      const { rows } = await client.query<{
        new_status: string;
        previous_status: string | null;
        reason: string | null;
        effective_date: string;
      }>(
        `SELECT previous_status, new_status, reason, effective_date::text
         FROM enrollment_history
         WHERE enrollment_id = $1
         ORDER BY created_at ASC, id ASC`,
        [fx.enrollmentId],
      );
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.new_status === 'ENROLLED')).toHaveLength(1);
      const statusChanges = rows.filter((row) => row.new_status === 'WITHDRAWN');
      expect(statusChanges).toHaveLength(1);
      expect(statusChanges[0]).toEqual({
        previous_status: 'ENROLLED',
        new_status: 'WITHDRAWN',
        reason: 'Family relocated',
        effective_date: '2026-08-31',
      });
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('grade INSERT and score UPDATE each write exactly one actor-attributed event', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertActorId = randomUUID();
      const updateActorId = randomUUID();
      const fx = await seedTenantGraph(client, { gradeActorId: insertActorId });
      await client.query(`SELECT set_config('app.grade_change_action', 'grade.score_change', true)`);
      await client.query(`SELECT set_config('app.grade_change_actor_id', $1, true)`, [
        updateActorId,
      ]);
      await client.query(
        `UPDATE grade_entries SET numeric_score = 95, letter_grade = 'A', updated_at = NOW()
         WHERE id = $1`,
        [fx.gradeEntryId],
      );
      const { rows } = await client.query<{
        action: string;
        actor_id: string | null;
        from_numeric_score: string | null;
        to_numeric_score: string | null;
      }>(
        `SELECT action, actor_id, from_numeric_score::text, to_numeric_score::text
         FROM grade_change_audit
         WHERE grade_entry_id = $1
         ORDER BY created_at ASC, id ASC`,
        [fx.gradeEntryId],
      );
      expect(rows).toHaveLength(2);
      const inserts = rows.filter((row) => row.action === 'grade.insert');
      const scoreChanges = rows.filter((row) => row.action === 'grade.score_change');
      expect(inserts).toHaveLength(1);
      expect(scoreChanges).toHaveLength(1);
      expect(inserts[0]!.actor_id).toBe(insertActorId);
      expect(inserts[0]!.from_numeric_score).toBeNull();
      expect(Number(inserts[0]!.to_numeric_score)).toBe(80);
      expect(scoreChanges[0]!.actor_id).toBe(updateActorId);
      expect(Number(scoreChanges[0]!.from_numeric_score)).toBe(80);
      expect(Number(scoreChanges[0]!.to_numeric_score)).toBe(95);
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('grade INSERT and workflow UPDATE each write exactly one actor-attributed event', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const insertActorId = randomUUID();
      const workflowActorId = randomUUID();
      const fx = await seedTenantGraph(client, { gradeActorId: insertActorId });
      await client.query(`SELECT set_config('app.grade_change_action', 'grade.submit', true)`);
      await client.query(`SELECT set_config('app.grade_change_actor_id', $1, true)`, [
        workflowActorId,
      ]);
      await client.query(
        `UPDATE grade_entries
         SET metadata = jsonb_set(metadata, '{workflowStatus}', '"SUBMITTED"'::jsonb),
             updated_at = NOW()
         WHERE id = $1`,
        [fx.gradeEntryId],
      );
      const { rows } = await client.query<{
        action: string;
        actor_id: string | null;
        from_status: string | null;
        to_status: string | null;
      }>(
        `SELECT action, actor_id, from_status, to_status
         FROM grade_change_audit
         WHERE grade_entry_id = $1
         ORDER BY created_at ASC, id ASC`,
        [fx.gradeEntryId],
      );
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.action === 'grade.insert')).toHaveLength(1);
      const workflowChanges = rows.filter((row) => row.action === 'grade.submit');
      expect(workflowChanges).toHaveLength(1);
      expect(workflowChanges[0]).toEqual({
        action: 'grade.submit',
        actor_id: workflowActorId,
        from_status: 'DRAFT',
        to_status: 'SUBMITTED',
      });
      await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  });

  it('rejects direct INSERT/UPDATE/DELETE on trigger-owned audit tables', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const fx = await seedTenantGraph(client);

      const expectMutateReject = async (label: string, sql: string, params: unknown[]) => {
        await client.query(`SAVEPOINT ${label}`);
        await expect(client.query(sql, params)).rejects.toThrow(/append-only|permission denied/i);
        await client.query(`ROLLBACK TO SAVEPOINT ${label}`);
      };

      await expectMutateReject(
        'sp_enr_ins',
        `INSERT INTO enrollment_history (
           tenant_id, enrollment_id, previous_status, new_status, effective_date,
           institution_id, academic_period_id, reason
         ) VALUES ($1, $2, 'ENROLLED', 'WITHDRAWN', CURRENT_DATE, $3, $4, 'duplicate')`,
        [fx.tenantId, fx.enrollmentId, fx.institutionId, fx.academicPeriodId],
      );
      await expectMutateReject(
        'sp_grd_ins',
        `INSERT INTO grade_change_audit (tenant_id, grade_entry_id, action, details)
         VALUES ($1, $2, 'duplicate', '{}'::jsonb)`,
        [fx.tenantId, fx.gradeEntryId],
      );
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

  it('catalog has exactly one validated canonical RESTRICT FK per audited parent', async () => {
    const specs = [
      {
        table: 'enrollment_history',
        column: 'enrollment_id',
        name: 'enrollment_history_enrollment_id_fkey',
        parent: 'enrollments',
      },
      {
        table: 'grade_change_audit',
        column: 'grade_entry_id',
        name: 'grade_change_audit_grade_entry_id_fkey',
        parent: 'grade_entries',
      },
    ] as const;

    for (const spec of specs) {
      const { rows } = await pool.query<{
        conname: string;
        convalidated: boolean;
        confdeltype: string;
        parent_table: string;
        definition: string;
      }>(
        `SELECT
           c.conname,
           c.convalidated,
           c.confdeltype::text,
           parent.relname AS parent_table,
           pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class rel ON rel.oid = c.conrelid
         JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         JOIN pg_class parent ON parent.oid = c.confrelid
         JOIN pg_attribute child_col
           ON child_col.attrelid = c.conrelid
          AND child_col.attnum = ANY (c.conkey)
         WHERE c.contype = 'f'
           AND nsp.nspname = 'public'
           AND rel.relname = $1
           AND child_col.attname = $2`,
        [spec.table, spec.column],
      );
      expect(rows, `${spec.table}.${spec.column} FK count`).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        conname: spec.name,
        convalidated: true,
        confdeltype: 'r',
        parent_table: spec.parent,
      });
      expect(rows[0]!.definition).toMatch(/ON DELETE RESTRICT/i);
    }
  });

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    '092 transactionally quarantines a legacy orphan before validating the FK',
    async () => {
      const migrator = new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL! });
      const client = await migrator.connect();
      try {
        await client.query('BEGIN');
        const tenantId = randomUUID();
        const sourceAuditId = randomUUID();
        const orphanGradeEntryId = randomUUID();
        const suffix = tenantId.slice(0, 8);

        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
        await client.query(
          `INSERT INTO tenants (id, name, slug, status)
           VALUES ($1, $2, $3, 'active')`,
          [tenantId, `audit-orphan-${suffix}`, `audit-orphan-${suffix}`],
        );
        await client.query(
          `ALTER TABLE grade_change_audit
           DROP CONSTRAINT grade_change_audit_grade_entry_id_fkey`,
        );
        await client.query(
          `INSERT INTO grade_change_audit (
             id, tenant_id, grade_entry_id, action, actor_id, details
           ) VALUES ($1, $2, $3, 'legacy.orphan', 'legacy-actor', '{"reason":"legacy import"}'::jsonb)`,
          [sourceAuditId, tenantId, orphanGradeEntryId],
        );

        await client.query(loadMigration('092_w1_data_14_audit_fk_integrity.sql'));

        const { rows: sourceRows } = await client.query<{ count: number }>(
          `SELECT COUNT(*)::int AS count FROM grade_change_audit WHERE id = $1`,
          [sourceAuditId],
        );
        expect(sourceRows[0]!.count).toBe(0);

        const { rows: quarantineRows } = await client.query<{
          tenant_id: string;
          grade_entry_id: string;
          source_row: Record<string, unknown>;
          quarantine_reason: string;
          source_migration: string;
        }>(
          `SELECT tenant_id::text, grade_entry_id::text, source_row,
                  quarantine_reason, source_migration
           FROM grade_change_audit_orphan_quarantine
           WHERE source_audit_id = $1`,
          [sourceAuditId],
        );
        expect(quarantineRows).toHaveLength(1);
        expect(quarantineRows[0]).toMatchObject({
          tenant_id: tenantId,
          grade_entry_id: orphanGradeEntryId,
          source_migration: '092_w1_data_14_audit_fk_integrity.sql',
        });
        expect(quarantineRows[0]!.quarantine_reason).toMatch(/Missing grade_entries parent/);
        expect(quarantineRows[0]!.source_row).toMatchObject({
          id: sourceAuditId,
          tenant_id: tenantId,
          grade_entry_id: orphanGradeEntryId,
          action: 'legacy.orphan',
          actor_id: 'legacy-actor',
          details: { reason: 'legacy import' },
        });

        const { rows: fkRows } = await client.query<{ convalidated: boolean }>(
          `SELECT convalidated
           FROM pg_constraint
           WHERE conrelid = 'public.grade_change_audit'::regclass
             AND conname = 'grade_change_audit_grade_entry_id_fkey'`,
        );
        expect(fkRows).toEqual([{ convalidated: true }]);

        await client.query('ROLLBACK');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
        await migrator.end();
      }
    },
  );
});
