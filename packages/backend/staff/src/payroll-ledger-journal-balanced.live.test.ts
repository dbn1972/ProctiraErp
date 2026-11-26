/**
 * PRC-M201 — live Postgres proof that every staff_payroll_ledger_entries
 * journal balances (sum of debits = sum of credits) when the transaction
 * commits, like the fee ledger (db/sql/023).
 *
 * Before db/sql/320 a one-legged payroll journal commits. After 320 the
 * deferred constraint trigger rejects the COMMIT of an unbalanced journal,
 * while a balanced three-leg journal (salary expense = deductions + wages
 * payable) commits. The 245 append-only triggers stay in force.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 320.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'payroll-ledger-journal-balanced.live.test',
});

describe.skipIf(!DATABASE_URL)('PRC-M201 balanced payroll journals (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertRun(client: pg.PoolClient, tenantId: string): Promise<string> {
    const runId = randomUUID();
    await client.query(
      `INSERT INTO staff_payroll_runs (
         id, tenant_id, month, status, gross_cents, deductions_cents, net_cents
       ) VALUES ($1, $2, '2026-04', 'posted', 10000, 1000, 9000)`,
      [runId, tenantId],
    );
    return runId;
  }

  async function insertLeg(
    client: pg.PoolClient,
    tenantId: string,
    runId: string,
    journalId: string,
    account: 'salary_expense' | 'payroll_deductions' | 'wages_payable',
    side: 'debit' | 'credit',
    amountCents: number,
  ): Promise<void> {
    await client.query(
      `INSERT INTO staff_payroll_ledger_entries (
         id, tenant_id, run_id, journal_id, account, side, amount_cents
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [randomUUID(), tenantId, runId, journalId, account, side, amountCents],
    );
  }

  async function begin(): Promise<{ client: pg.PoolClient; tenantId: string }> {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const client = await pool.connect();
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    return { client, tenantId };
  }

  it('rejects the COMMIT of a one-legged payroll journal', async () => {
    const { client, tenantId } = await begin();
    try {
      const runId = await insertRun(client, tenantId);
      await insertLeg(client, tenantId, runId, randomUUID(), 'salary_expense', 'debit', 10000);
      await expect(client.query('COMMIT')).rejects.toThrow(/unbalanced/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('rejects the COMMIT when credits fall short of debits', async () => {
    const { client, tenantId } = await begin();
    try {
      const runId = await insertRun(client, tenantId);
      const journalId = randomUUID();
      await insertLeg(client, tenantId, runId, journalId, 'salary_expense', 'debit', 10000);
      await insertLeg(client, tenantId, runId, journalId, 'payroll_deductions', 'credit', 1000);
      await insertLeg(client, tenantId, runId, journalId, 'wages_payable', 'credit', 8999);
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23000' });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('commits a balanced journal, which stays append-only', async () => {
    const { client, tenantId } = await begin();
    let committed = false;
    try {
      const runId = await insertRun(client, tenantId);
      const journalId = randomUUID();
      await insertLeg(client, tenantId, runId, journalId, 'salary_expense', 'debit', 10000);
      await insertLeg(client, tenantId, runId, journalId, 'payroll_deductions', 'credit', 1000);
      await insertLeg(client, tenantId, runId, journalId, 'wages_payable', 'credit', 9000);
      await client.query('COMMIT');
      committed = true;

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const { rows } = await client.query<{ debit: string; credit: string }>(
        `SELECT COALESCE(SUM(amount_cents) FILTER (WHERE side = 'debit'), 0)::text AS debit,
                COALESCE(SUM(amount_cents) FILTER (WHERE side = 'credit'), 0)::text AS credit
           FROM staff_payroll_ledger_entries WHERE tenant_id = $1 AND journal_id = $2`,
        [tenantId, journalId],
      );
      expect(rows[0]).toEqual({ debit: '10000', credit: '10000' });
      await expect(
        client.query(
          `UPDATE staff_payroll_ledger_entries SET amount_cents = 1 WHERE journal_id = $1`,
          [journalId],
        ),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK');
    } finally {
      if (!committed) await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('checks each journal on its own when two journals share a transaction', async () => {
    const { client, tenantId } = await begin();
    try {
      const runId = await insertRun(client, tenantId);
      const balanced = randomUUID();
      await insertLeg(client, tenantId, runId, balanced, 'salary_expense', 'debit', 500);
      await insertLeg(client, tenantId, runId, balanced, 'wages_payable', 'credit', 500);
      // The transaction as a whole balances, but each of these journals does not.
      await insertLeg(client, tenantId, runId, randomUUID(), 'salary_expense', 'debit', 700);
      await insertLeg(client, tenantId, runId, randomUUID(), 'wages_payable', 'credit', 700);
      await expect(client.query('COMMIT')).rejects.toThrow(/unbalanced/i);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
