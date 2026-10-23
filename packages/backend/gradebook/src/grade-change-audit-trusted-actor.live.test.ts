/**
 * PRC-L293 — live Postgres red-then-green proof that
 * `grade_entries_write_change_audit()` prefers the trusted `entered_by`
 * column over the client/session-settable `app.grade_change_actor_id` GUC
 * when resolving `grade_change_audit.actor_id`.
 *
 * Before db/sql/241 (080's original precedence): the GUC wins whenever it is
 * set, even if `entered_by` was already populated -- so a caller on the same
 * connection that sets the GUC to an attacker-chosen id after `entered_by`
 * has been correctly resolved still gets its value recorded as the actor.
 * After 241: `entered_by` wins; the GUC is only a fallback when
 * `entered_by` is NULL (legacy/system-only writes).
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 080.
 * Optional MIGRATOR_DATABASE_URL (table-owning role) is used to apply/revert
 * 241 for the red phase; when unset, the red phase is skipped and only the
 * green (post-241) behavior is asserted.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'grade-change-audit-trusted-actor.live.test',
});
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL'];

const MIGRATION_241 = '241_actor_reason_trusted_source.sql';

// db/sql/080's original function: the GUC is checked FIRST, entered_by only
// as a fallback. Reinstating this is the RED fixture.
const PRE_241_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION grade_entries_write_change_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action TEXT;
  v_actor TEXT;
  v_from_status TEXT;
  v_to_status TEXT;
  material_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    material_changed := TRUE;
  ELSE
    material_changed :=
      OLD.numeric_score IS DISTINCT FROM NEW.numeric_score
      OR OLD.letter_grade IS DISTINCT FROM NEW.letter_grade
      OR OLD.locked_at IS DISTINCT FROM NEW.locked_at
      OR OLD.published_at IS DISTINCT FROM NEW.published_at
      OR COALESCE(OLD.metadata->>'workflowStatus', '')
           IS DISTINCT FROM COALESCE(NEW.metadata->>'workflowStatus', '');
  END IF;

  IF NOT material_changed THEN
    RETURN NEW;
  END IF;

  v_from_status := CASE
    WHEN TG_OP = 'INSERT' THEN NULL
    ELSE NULLIF(OLD.metadata->>'workflowStatus', '')
  END;
  v_to_status := NULLIF(NEW.metadata->>'workflowStatus', '');
  IF v_to_status IS NULL AND NEW.published_at IS NOT NULL THEN
    v_to_status := 'PUBLISHED';
  ELSIF v_to_status IS NULL AND NEW.locked_at IS NOT NULL THEN
    v_to_status := 'LOCKED';
  ELSIF v_to_status IS NULL THEN
    v_to_status := 'DRAFT';
  END IF;

  v_action := NULLIF(current_setting('app.grade_change_action', true), '');
  IF v_action IS NULL THEN
    IF TG_OP = 'INSERT' THEN
      v_action := 'grade.insert';
    ELSIF COALESCE(OLD.metadata->>'workflowStatus', '')
            IS DISTINCT FROM COALESCE(NEW.metadata->>'workflowStatus', '')
          OR OLD.locked_at IS DISTINCT FROM NEW.locked_at
          OR OLD.published_at IS DISTINCT FROM NEW.published_at THEN
      v_action := 'grade.workflow';
    ELSE
      v_action := 'grade.score_change';
    END IF;
  END IF;

  -- Bug under test: GUC checked first.
  v_actor := NULLIF(current_setting('app.grade_change_actor_id', true), '');
  IF v_actor IS NULL AND NEW.entered_by IS NOT NULL THEN
    v_actor := NEW.entered_by::text;
  END IF;

  INSERT INTO grade_change_audit (
    tenant_id, grade_entry_id, action, from_status, to_status,
    from_numeric_score, to_numeric_score, from_letter_grade, to_letter_grade,
    actor_id, details
  ) VALUES (
    NEW.tenant_id, NEW.id, v_action, v_from_status, v_to_status,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.numeric_score END,
    NEW.numeric_score,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.letter_grade END,
    NEW.letter_grade, v_actor,
    jsonb_build_object('source', 'database_trigger', 'op', TG_OP)
  );

  RETURN NEW;
END;
$$;
`;

function load241(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  return readFileSync(path.join(root, 'db/sql', MIGRATION_241), 'utf8');
}

describe.skipIf(!DATABASE_URL)('PRC-L293 grade change audit trusted actor (live)', () => {
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

  async function seedMinimalGraph(client: pg.PoolClient): Promise<{
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
      [tenantId, `l293-${suffix}`, `l293-${suffix}`],
    );
    await client.query(
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, $2, 'L293', 'Student', '2012-01-01', 'unspecified')`,
      [studentId, tenantId],
    );
    return { tenantId, studentId };
  }

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    'RED: pre-241 trigger lets an attacker-set GUC override a correctly-set entered_by',
    async () => {
      const m = migrator!;
      try {
        await m.query(PRE_241_FUNCTION_SQL);

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const { tenantId, studentId } = await seedMinimalGraph(client);
          const trustedActorId = randomUUID();
          const attackerActorId = randomUUID();
          const gradeEntryId = randomUUID();

          // Application correctly resolves entered_by from the authenticated
          // user (packages/backend/gradebook/src/gradebook-service.ts's
          // actorId(user))...
          await client.query(
            `INSERT INTO grade_entries (
               id, tenant_id, student_id, numeric_score, letter_grade, entered_by, metadata
             ) VALUES ($1, $2, $3, 80, 'B', $4, '{}'::jsonb)`,
            [gradeEntryId, tenantId, studentId, trustedActorId],
          );

          // ...but a caller on the same connection (direct SQL access, or a
          // session-GUC bug) sets the GUC to a different, attacker-chosen
          // actor id before the UPDATE that fires the audit trigger.
          await client.query(`SELECT set_config('app.grade_change_actor_id', $1, true)`, [
            attackerActorId,
          ]);
          await client.query(
            `UPDATE grade_entries SET numeric_score = 95, letter_grade = 'A' WHERE id = $1`,
            [gradeEntryId],
          );

          const { rows } = await client.query<{ actor_id: string }>(
            `SELECT actor_id FROM grade_change_audit
             WHERE grade_entry_id = $1 AND action = 'grade.score_change'`,
            [gradeEntryId],
          );
          expect(rows).toHaveLength(1);
          // Demonstrates the bug: the GUC (attacker) wins over entered_by (trusted).
          expect(rows[0]!.actor_id).toBe(attackerActorId);
          expect(rows[0]!.actor_id).not.toBe(trustedActorId);

          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      } finally {
        // Restore the fixed trigger so GREEN below is unaffected regardless
        // of RED's outcome.
        await m.query(load241());
      }
    },
  );

  it('GREEN: post-241 trigger prefers entered_by over the GUC', async () => {
    if (migrator) {
      await migrator.query(load241());
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId, studentId } = await seedMinimalGraph(client);
      const trustedActorId = randomUUID();
      const attackerActorId = randomUUID();
      const gradeEntryId = randomUUID();

      await client.query(
        `INSERT INTO grade_entries (
           id, tenant_id, student_id, numeric_score, letter_grade, entered_by, metadata
         ) VALUES ($1, $2, $3, 80, 'B', $4, '{}'::jsonb)`,
        [gradeEntryId, tenantId, studentId, trustedActorId],
      );

      await client.query(`SELECT set_config('app.grade_change_actor_id', $1, true)`, [
        attackerActorId,
      ]);
      await client.query(
        `UPDATE grade_entries SET numeric_score = 95, letter_grade = 'A' WHERE id = $1`,
        [gradeEntryId],
      );

      const { rows } = await client.query<{ actor_id: string }>(
        `SELECT actor_id FROM grade_change_audit
         WHERE grade_entry_id = $1 AND action = 'grade.score_change'`,
        [gradeEntryId],
      );
      expect(rows).toHaveLength(1);
      // Fixed: entered_by (trusted) wins, the attacker's GUC is ignored.
      expect(rows[0]!.actor_id).toBe(trustedActorId);
      expect(rows[0]!.actor_id).not.toBe(attackerActorId);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: no regression — a row with entered_by NULL still falls back to the GUC', async () => {
    if (migrator) {
      await migrator.query(load241());
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId, studentId } = await seedMinimalGraph(client);
      const systemActorId = randomUUID();
      const gradeEntryId = randomUUID();

      // Legacy / system-only write: entered_by is never populated, only the GUC.
      await client.query(`SELECT set_config('app.grade_change_actor_id', $1, true)`, [
        systemActorId,
      ]);
      await client.query(
        `INSERT INTO grade_entries (
           id, tenant_id, student_id, numeric_score, letter_grade, entered_by, metadata
         ) VALUES ($1, $2, $3, 70, 'C', NULL, '{}'::jsonb)`,
        [gradeEntryId, tenantId, studentId],
      );

      const { rows } = await client.query<{ actor_id: string }>(
        `SELECT actor_id FROM grade_change_audit
         WHERE grade_entry_id = $1 AND action = 'grade.insert'`,
        [gradeEntryId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.actor_id).toBe(systemActorId);

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
