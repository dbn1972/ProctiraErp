/**
 * PRC-M213 — live Postgres red-then-green proof that academic_periods and
 * fee_structures overlap protection is enforced by a gist EXCLUDE
 * constraint (db/sql/248) instead of the race-prone SELECT-check BEFORE
 * triggers from db/sql/083.
 *
 * Before db/sql/248 (083's original triggers): a sequential overlapping
 * insert is still rejected by the trigger (083 already works for the
 * sequential case), but the mechanism is a SELECT-then-raise check that is
 * not safe against two concurrent transactions each reading "no conflict"
 * before either commits.
 * After 248: the gist EXCLUDE constraint rejects a sequential overlapping
 * insert via Postgres's own index-conflict detection at commit time (not a
 * SELECT the application could race past), and a non-overlapping insert
 * still succeeds. A true concurrent-interleaving simulation is included to
 * demonstrate the EXCLUDE constraint holds under concurrency, since that is
 * the exact race class 083's trigger could not close.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 083.
 * Optional MIGRATOR_DATABASE_URL (table-owning role) is used to apply 248
 * for the GREEN phase when not already applied; when unset, 248 is assumed
 * already applied on DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensurePgTestTenant } from './test-fixtures.js';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'academic-fee-overlap-exclusion.live.test',
});
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL'];

const MIGRATION_248 = '248_academic_fee_overlap_exclusion.sql';

function load248(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  return readFileSync(path.join(root, 'db/sql', MIGRATION_248), 'utf8');
}

describe.skipIf(!DATABASE_URL)('PRC-M213 academic/fee overlap EXCLUDE constraint (live)', () => {
  let pool: pg.Pool;
  let migrator: pg.Pool | undefined;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    if (MIGRATOR_DATABASE_URL) {
      migrator = new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL });
      await migrator.query(load248());
    }
  });

  afterAll(async () => {
    await pool.end();
    await migrator?.end();
  });

  it('GREEN: a sequential overlapping academic_periods insert is rejected (exclusion_violation)', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      await client.query(
        `INSERT INTO academic_periods (
           id, tenant_id, name, code, start_date, end_date, valid_from, valid_to, version
         ) VALUES ($1, $2, 'P1', 'OVL1', '2026-01-01', '2026-06-30', '2026-01-01', '2026-06-30', 1)`,
        [randomUUID(), tenantId],
      );

      await expect(
        client.query(
          `INSERT INTO academic_periods (
             id, tenant_id, name, code, start_date, end_date, valid_from, valid_to, version
           ) VALUES ($1, $2, 'P2', 'OVL1', '2026-06-01', '2026-12-31', '2026-06-01', '2026-12-31', 2)`,
          [randomUUID(), tenantId],
        ),
      ).rejects.toMatchObject({ code: '23P01' });

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: a non-overlapping academic_periods insert for the same code still succeeds', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      await client.query(
        `INSERT INTO academic_periods (
           id, tenant_id, name, code, start_date, end_date, valid_from, valid_to, version
         ) VALUES ($1, $2, 'P1', 'OVL2', '2026-01-01', '2026-06-30', '2026-01-01', '2026-06-30', 1)`,
        [randomUUID(), tenantId],
      );
      // Adjacent, non-overlapping window for the same code succeeds.
      await client.query(
        `INSERT INTO academic_periods (
           id, tenant_id, name, code, start_date, end_date, valid_from, valid_to, version
         ) VALUES ($1, $2, 'P2', 'OVL2', '2026-07-01', '2026-12-31', '2026-07-01', '2026-12-31', 2)`,
        [randomUUID(), tenantId],
      );

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: a sequential overlapping fee_structures insert is rejected (exclusion_violation)', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      await client.query(
        `INSERT INTO fee_structures (
           id, tenant_id, category, code, name, amount_cents, valid_from, valid_to, version, status
         ) VALUES ($1, $2, 'tuition', 'FOVL1', 'Fee 1', 1000, '2026-01-01', '2026-06-30', 1, 'active')`,
        [randomUUID(), tenantId],
      );

      await expect(
        client.query(
          `INSERT INTO fee_structures (
             id, tenant_id, category, code, name, amount_cents, valid_from, valid_to, version, status
           ) VALUES ($1, $2, 'tuition', 'FOVL1', 'Fee 1 v2', 1200, '2026-06-01', '2026-12-31', 2, 'active')`,
          [randomUUID(), tenantId],
        ),
      ).rejects.toMatchObject({ code: '23P01' });

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: a non-active fee_structures row does not participate in the exclusion', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      await client.query(
        `INSERT INTO fee_structures (
           id, tenant_id, category, code, name, amount_cents, valid_from, valid_to, version, status
         ) VALUES ($1, $2, 'tuition', 'FOVL2', 'Fee 1 archived', 1000, '2026-01-01', '2026-06-30', 1, 'archived')`,
        [randomUUID(), tenantId],
      );
      // Overlapping window but the archived row is excluded by the partial
      // WHERE (status = 'active') predicate, so this active insert succeeds.
      await client.query(
        `INSERT INTO fee_structures (
           id, tenant_id, category, code, name, amount_cents, valid_from, valid_to, version, status
         ) VALUES ($1, $2, 'tuition', 'FOVL2', 'Fee 1 active', 1200, '2026-01-01', '2026-06-30', 2, 'active')`,
        [randomUUID(), tenantId],
      );

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    'RED: pre-248 SELECT-check trigger lets two concurrent overlapping inserts both commit',
    async () => {
      const m = migrator!;
      const tenantId = randomUUID();
      await ensurePgTestTenant(pool, tenantId);

      // Reinstate 083's original race-prone SELECT-check trigger on
      // academic_periods by dropping the gist EXCLUDE constraint 248 added
      // and recreating 083's academic_periods_reject_overlap() function +
      // trigger verbatim.
      await m.query(`
        ALTER TABLE academic_periods DROP CONSTRAINT IF EXISTS academic_periods_no_overlap_excl;

        CREATE OR REPLACE FUNCTION academic_periods_reject_overlap()
        RETURNS TRIGGER AS $$
        DECLARE
          conflict_id UUID;
        BEGIN
          IF NEW.deleted_at IS NOT NULL THEN
            RETURN NEW;
          END IF;
          SELECT id INTO conflict_id
          FROM academic_periods ap
          WHERE ap.tenant_id = NEW.tenant_id
            AND ap.code = NEW.code
            AND ap.deleted_at IS NULL
            AND ap.id IS DISTINCT FROM NEW.id
            AND daterange(ap.valid_from, ap.valid_to, '[]') &&
                daterange(NEW.valid_from, NEW.valid_to, '[]')
          LIMIT 1;
          IF conflict_id IS NOT NULL THEN
            RAISE EXCEPTION
              'academic_periods version overlap for code % (conflicts with %)', NEW.code, conflict_id
              USING ERRCODE = 'exclusion_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_academic_periods_reject_overlap ON academic_periods;
        CREATE TRIGGER trg_academic_periods_reject_overlap
          BEFORE INSERT OR UPDATE OF valid_from, valid_to, deleted_at, code ON academic_periods
          FOR EACH ROW
          EXECUTE FUNCTION academic_periods_reject_overlap();
      `);

      const clientA = await pool.connect();
      const clientB = await pool.connect();
      try {
        await clientA.query('BEGIN');
        await clientB.query('BEGIN');
        await clientA.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        await clientB.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

        // A inserts and does NOT commit yet. The trigger's own SELECT finds
        // no conflict (nothing else exists for this code), so it allows the
        // insert.
        await clientA.query(
          `INSERT INTO academic_periods (
               id, tenant_id, name, code, start_date, end_date, valid_from, valid_to, version
             ) VALUES ($1, $2, 'A', 'RACE1-RED', '2026-01-01', '2026-06-30', '2026-01-01', '2026-06-30', 1)`,
          [randomUUID(), tenantId],
        );

        // B's conflicting INSERT is issued while A's row is still
        // uncommitted. Unlike the EXCLUDE constraint, the trigger's SELECT
        // takes no lock and reads only committed data (READ COMMITTED), so
        // it does not see A's uncommitted row and finds "no conflict" too --
        // B's INSERT completes immediately instead of blocking. This is the
        // exact race PRC-M213 closes: both transactions pass the SELECT
        // check before either commits.
        await clientB.query(
          `INSERT INTO academic_periods (
               id, tenant_id, name, code, start_date, end_date, valid_from, valid_to, version
             ) VALUES ($1, $2, 'B', 'RACE1-RED', '2026-06-01', '2026-12-31', '2026-06-01', '2026-12-31', 2)`,
          [randomUUID(), tenantId],
        );

        // Both transactions commit successfully -- the bug: two mutually
        // overlapping active versions now coexist.
        await clientA.query('COMMIT');
        await clientB.query('COMMIT');

        await clientA.query('BEGIN');
        await clientA.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        const { rows } = await clientA.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM academic_periods WHERE tenant_id = $1 AND code = 'RACE1-RED'`,
          [tenantId],
        );
        await clientA.query('COMMIT');
        expect(rows[0]!.count, 'both overlapping inserts committed under the pre-248 trigger').toBe(
          '2',
        );

        // Clean up the two overlapping rows this RED probe committed so the
        // 248 restore's overlap preflight (below) sees zero conflicts.
        await clientA.query('BEGIN');
        await clientA.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        await clientA.query(
          `DELETE FROM academic_periods WHERE tenant_id = $1 AND code = 'RACE1-RED'`,
          [tenantId],
        );
        await clientA.query('COMMIT');
      } finally {
        clientA.release();
        clientB.release();
        // Restore 248: re-adds the gist EXCLUDE constraint and drops the
        // SELECT-check trigger/function this RED probe reinstated, so GREEN
        // tests above and any later run see the fixed state again.
        await m.query(load248());
      }
    },
  );

  it('GREEN: true concurrent interleaving — B inserts a conflicting row before A commits, B blocks then loses', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);

    const clientA = await pool.connect();
    const clientB = await pool.connect();
    try {
      await clientA.query('BEGIN');
      await clientB.query('BEGIN');
      await clientA.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await clientB.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

      // A inserts and does NOT commit yet.
      await clientA.query(
        `INSERT INTO academic_periods (
             id, tenant_id, name, code, start_date, end_date, valid_from, valid_to, version
           ) VALUES ($1, $2, 'A', 'RACE1', '2026-01-01', '2026-06-30', '2026-01-01', '2026-06-30', 1)`,
        [randomUUID(), tenantId],
      );

      // B's conflicting INSERT is issued while A's row is still
      // uncommitted -- this is the exact interleaving the old SELECT-check
      // trigger (083) could not have caught: a plain SELECT from B at this
      // instant would see zero rows from A's uncommitted transaction and
      // let B's INSERT proceed unguarded. The gist EXCLUDE constraint
      // instead makes B's INSERT itself block, waiting on A's
      // not-yet-resolved transaction, rather than racing past a stale read.
      const insertB = clientB.query(
        `INSERT INTO academic_periods (
             id, tenant_id, name, code, start_date, end_date, valid_from, valid_to, version
           ) VALUES ($1, $2, 'B', 'RACE1', '2026-06-01', '2026-12-31', '2026-06-01', '2026-12-31', 2)`,
        [randomUUID(), tenantId],
      );

      // Give B's INSERT a moment to reach Postgres and start waiting on A.
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Commit A -- this resolves the wait: B's blocked INSERT now sees a
      // committed, visible conflicting row and fails.
      await clientA.query('COMMIT');

      await expect(insertB).rejects.toMatchObject({ code: '23P01' });

      // set_config's third argument (true = local) reset the GUC at
      // clientA's COMMIT above, so re-bind it inside a fresh transaction
      // before the verifying SELECT (FORCE RLS would otherwise see zero
      // rows with no GUC bound).
      await clientA.query('BEGIN');
      await clientA.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const { rows } = await clientA.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM academic_periods WHERE tenant_id = $1 AND code = 'RACE1'`,
        [tenantId],
      );
      await clientA.query('COMMIT');
      expect(rows[0]!.count).toBe('1');
    } finally {
      await clientB.query('ROLLBACK').catch(() => undefined);
      clientA.release();
      clientB.release();
    }
  });
});
