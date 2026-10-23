/**
 * PRC-M198 — live Postgres red-then-green proof for two SIS data-integrity
 * gaps closed by db/sql/244:
 *
 * (A) range checks: grade_entries.numeric_score and academic_periods'
 *     start_date/end_date had no DB-level CHECK, so a direct write could
 *     store a score outside 0..100 or an end_date before start_date even
 *     though the app layer (schemas.ts's `Type.Number({ minimum: 0,
 *     maximum: 100 })`) already rejects it at the API boundary.
 * (B) locked-grade guard: a locked grade_entries row (locked_at IS NOT NULL)
 *     could still have its numeric_score/letter_grade mutated by a direct
 *     SQL UPDATE; only the app-layer requireUnlocked guard in
 *     pg-gradebook-repository.ts's updateGradeEntry stopped it.
 *
 * Before db/sql/244: both writes succeed. After 244: both are rejected,
 * while the app's real unlock-then-edit sequence (two separate UPDATEs —
 * unlock first, so the edit UPDATE's OLD.locked_at is already NULL) still
 * works.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 083.
 * Optional MIGRATOR_DATABASE_URL (table-owning role) is used to drop/restore
 * 244's trigger for the red phase; when unset, the red phase is skipped.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'grade-entries-range-locked-guard.live.test',
});
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL'];

const MIGRATION_244 = '244_sis_range_checks_locked_grade_guard.sql';
const TRIGGER_NAME = 'trg_grade_entries_locked_immutable';

function load244(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  return readFileSync(path.join(root, 'db/sql', MIGRATION_244), 'utf8');
}

describe.skipIf(!DATABASE_URL)('PRC-M198 SIS range checks + locked-grade guard (live)', () => {
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

  async function seedStudent(client: pg.PoolClient): Promise<{
    tenantId: string;
    studentId: string;
  }> {
    const tenantId = randomUUID();
    const studentId = randomUUID();
    const suffix = tenantId.slice(0, 8);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
    await client.query(
      `INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, `m198-${suffix}`, `m198-${suffix}`],
    );
    await client.query(
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, $2, 'M198', 'Student', '2012-01-01', 'unspecified')`,
      [studentId, tenantId],
    );
    return { tenantId, studentId };
  }

  // ---------------------------------------------------------------------
  // Part A: range checks
  // ---------------------------------------------------------------------

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    'RED: without the CHECK, numeric_score outside 0..100 and end_date < start_date insert fine',
    async () => {
      const m = migrator!;
      try {
        await m.query(
          `ALTER TABLE grade_entries DROP CONSTRAINT IF EXISTS grade_entries_numeric_score_range_chk`,
        );
        await m.query(
          `ALTER TABLE academic_periods DROP CONSTRAINT IF EXISTS academic_periods_date_range_chk`,
        );

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const { tenantId, studentId } = await seedStudent(client);

          // The bug: a score of 150 is accepted at the DB layer.
          await client.query(
            `INSERT INTO grade_entries (id, tenant_id, student_id, numeric_score, letter_grade)
             VALUES ($1, $2, $3, 150, 'A')`,
            [randomUUID(), tenantId, studentId],
          );

          // The bug: an academic_periods row with end_date before start_date
          // is accepted (valid_from/valid_to mirror start/end on INSERT per
          // 083's sync trigger, so this also violates valid_to >= valid_from
          // — set both pairs explicitly to isolate the start/end check).
          await client.query(
            `INSERT INTO academic_periods (
               id, tenant_id, name, code, start_date, end_date, valid_from, valid_to
             ) VALUES ($1, $2, 'Bad Period', $3, '2026-06-01', '2026-01-01', '2026-06-01', '2026-06-01')`,
            [randomUUID(), tenantId, `BAD-${tenantId.slice(0, 8)}`],
          );

          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      } finally {
        await m.query(load244());
      }
    },
  );

  it('GREEN: numeric_score outside 0..100 is rejected', async () => {
    if (migrator) await migrator.query(load244());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId, studentId } = await seedStudent(client);

      await client.query('SAVEPOINT sp_bad_score');
      await expect(
        client.query(
          `INSERT INTO grade_entries (id, tenant_id, student_id, numeric_score, letter_grade)
           VALUES ($1, $2, $3, 150, 'A')`,
          [randomUUID(), tenantId, studentId],
        ),
      ).rejects.toThrow(/grade_entries_numeric_score_range_chk/);
      await client.query('ROLLBACK TO SAVEPOINT sp_bad_score');

      // A valid score (boundary 100) still succeeds.
      await client.query(
        `INSERT INTO grade_entries (id, tenant_id, student_id, numeric_score, letter_grade)
         VALUES ($1, $2, $3, 100, 'A')`,
        [randomUUID(), tenantId, studentId],
      );

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: academic_periods end_date < start_date is rejected', async () => {
    if (migrator) await migrator.query(load244());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId } = await seedStudent(client);

      await client.query('SAVEPOINT sp_bad_period');
      await expect(
        client.query(
          `INSERT INTO academic_periods (
             id, tenant_id, name, code, start_date, end_date, valid_from, valid_to
           ) VALUES ($1, $2, 'Bad Period', $3, '2026-06-01', '2026-01-01', '2026-06-01', '2026-06-01')`,
          [randomUUID(), tenantId, `BAD-${tenantId.slice(0, 8)}`],
        ),
      ).rejects.toThrow(/academic_periods_date_range_chk/);
      await client.query('ROLLBACK TO SAVEPOINT sp_bad_period');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  // ---------------------------------------------------------------------
  // Part B: locked-grade guard
  // ---------------------------------------------------------------------

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    'RED: without the trigger, a locked grade_entries row can still be mutated',
    async () => {
      const m = migrator!;
      try {
        await m.query(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON grade_entries`);

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const { tenantId, studentId } = await seedStudent(client);
          const gradeEntryId = randomUUID();
          await client.query(
            `INSERT INTO grade_entries (
               id, tenant_id, student_id, numeric_score, letter_grade, locked_at
             ) VALUES ($1, $2, $3, 90, 'A', now())`,
            [gradeEntryId, tenantId, studentId],
          );

          // The bug: a direct UPDATE of a locked row's score succeeds.
          await client.query(`UPDATE grade_entries SET numeric_score = 10 WHERE id = $1`, [
            gradeEntryId,
          ]);
          const { rows } = await client.query<{ numeric_score: string }>(
            `SELECT numeric_score FROM grade_entries WHERE id = $1`,
            [gradeEntryId],
          );
          expect(Number(rows[0]!.numeric_score)).toBe(10);

          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      } finally {
        await m.query(load244());
      }
    },
  );

  it('GREEN: mutating numeric_score/letter_grade on a locked row is rejected', async () => {
    if (migrator) await migrator.query(load244());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId, studentId } = await seedStudent(client);
      const gradeEntryId = randomUUID();
      await client.query(
        `INSERT INTO grade_entries (
           id, tenant_id, student_id, numeric_score, letter_grade, locked_at
         ) VALUES ($1, $2, $3, 90, 'A', now())`,
        [gradeEntryId, tenantId, studentId],
      );

      await client.query('SAVEPOINT sp_score');
      await expect(
        client.query(`UPDATE grade_entries SET numeric_score = 10 WHERE id = $1`, [gradeEntryId]),
      ).rejects.toThrow(/cannot be mutated while locked_at is set/);
      await client.query('ROLLBACK TO SAVEPOINT sp_score');

      await client.query('SAVEPOINT sp_letter');
      await expect(
        client.query(`UPDATE grade_entries SET letter_grade = 'F' WHERE id = $1`, [gradeEntryId]),
      ).rejects.toThrow(/cannot be mutated while locked_at is set/);
      await client.query('ROLLBACK TO SAVEPOINT sp_letter');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: unlocking (locked_at -> NULL) and other columns are unaffected', async () => {
    if (migrator) await migrator.query(load244());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId, studentId } = await seedStudent(client);
      const gradeEntryId = randomUUID();
      await client.query(
        `INSERT INTO grade_entries (
           id, tenant_id, student_id, numeric_score, letter_grade, locked_at
         ) VALUES ($1, $2, $3, 90, 'A', now())`,
        [gradeEntryId, tenantId, studentId],
      );

      // Unlocking itself is a separate, already-audited operation and must
      // not be blocked by this guard.
      await client.query(`UPDATE grade_entries SET locked_at = NULL WHERE id = $1`, [gradeEntryId]);

      // A metadata-only update while still locked is unaffected (the guard
      // only watches numeric_score/letter_grade).
      await client.query(`UPDATE grade_entries SET locked_at = now() WHERE id = $1`, [
        gradeEntryId,
      ]);
      await client.query(
        `UPDATE grade_entries SET metadata = '{"note":"ok"}'::jsonb WHERE id = $1`,
        [gradeEntryId],
      );

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: real unlock-then-edit sequence (two UPDATEs) still succeeds', async () => {
    if (migrator) await migrator.query(load244());

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId, studentId } = await seedStudent(client);
      const gradeEntryId = randomUUID();
      await client.query(
        `INSERT INTO grade_entries (
           id, tenant_id, student_id, numeric_score, letter_grade, locked_at
         ) VALUES ($1, $2, $3, 90, 'A', now())`,
        [gradeEntryId, tenantId, studentId],
      );

      // Step 1: unlock (locked_at -> NULL) -- the app's explicit-unlock UPDATE.
      await client.query(`UPDATE grade_entries SET locked_at = NULL WHERE id = $1`, [gradeEntryId]);
      // Step 2: the edit UPDATE now sees OLD.locked_at IS NULL, so the guard
      // does not fire.
      await client.query(
        `UPDATE grade_entries SET numeric_score = 75, letter_grade = 'C' WHERE id = $1`,
        [gradeEntryId],
      );

      const { rows } = await client.query<{ numeric_score: string; letter_grade: string }>(
        `SELECT numeric_score, letter_grade FROM grade_entries WHERE id = $1`,
        [gradeEntryId],
      );
      expect(Number(rows[0]!.numeric_score)).toBe(75);
      expect(rows[0]!.letter_grade).toBe('C');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
