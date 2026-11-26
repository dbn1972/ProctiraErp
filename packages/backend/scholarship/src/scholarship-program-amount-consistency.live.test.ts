/**
 * PRC-L094 — live Postgres proof that a scholarship programme's major-unit
 * and cents award amounts cannot disagree (db/sql/325).
 *
 * Before 325 a programme row could carry amount_per_recipient = 1000 with
 * amount_per_recipient_cents = 0 (or any other value). After 325 the CHECK
 * rejects such a write with 23514. (Whether 325 could VALIDATE the constraint
 * depends on legacy rows; that is checked on the fresh-build database.)
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 325.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPgScholarshipEnabled } from './create-scholarship-repository.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const live = isPgScholarshipEnabled();

describe.skipIf(!live)('PRC-L094 programme amount consistency (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function inTenant(fn: (c: pg.PoolClient, tenantId: string) => Promise<void>) {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await fn(client, tenantId);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  function insertProgram(c: pg.PoolClient, tenantId: string, major: string, cents: number) {
    const id = randomUUID();
    return c
      .query(
        `INSERT INTO scholarship_programs (
           id, tenant_id, name, application_start_date, application_end_date, total_slots,
           amount_per_recipient, amount_per_recipient_cents, currency, status
         ) VALUES ($1, $2, 'L094 programme', DATE '2026-01-01', DATE '2026-12-31', 5,
                   $3::numeric, $4, 'INR', 'open')`,
        [id, tenantId, major, cents],
      )
      .then(() => id);
  }

  it('rejects a programme whose cents disagree with its major amount', async () => {
    await inTenant(async (c, tenantId) => {
      await c.query('SAVEPOINT s1');
      await expect(insertProgram(c, tenantId, '1000', 0)).rejects.toMatchObject({
        code: '23514',
        constraint: 'scholarship_programs_amount_cents_consistent_chk',
      });
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await c.query('SAVEPOINT s2');
      await expect(insertProgram(c, tenantId, '10.005', 1001)).rejects.toMatchObject({
        code: '23514',
      });
      await c.query('ROLLBACK TO SAVEPOINT s2');
    });
  });

  it('rejects an update that changes one side only', async () => {
    await inTenant(async (c, tenantId) => {
      const id = await insertProgram(c, tenantId, '1250.50', 125050);
      await c.query('SAVEPOINT s1');
      await expect(
        c.query(`UPDATE scholarship_programs SET amount_per_recipient_cents = 1 WHERE id = $1`, [
          id,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await c.query('ROLLBACK TO SAVEPOINT s1');
      const ok = await c.query(
        `UPDATE scholarship_programs
            SET amount_per_recipient = 99.99, amount_per_recipient_cents = 9999
          WHERE id = $1`,
        [id],
      );
      expect(ok.rowCount).toBe(1);
    });
  });
});
