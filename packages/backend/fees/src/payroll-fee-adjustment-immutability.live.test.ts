/**
 * PRC-M201+M202 — live Postgres red-then-green proof that
 * staff_payroll_lines, staff_payroll_ledger_entries, fee_credit_notes, and
 * fee_write_offs are all append-only (db/sql/245), matching their sibling
 * staff_payroll_runs (db/sql/083).
 *
 * Before 245: a direct UPDATE/DELETE on a posted row in any of the four
 * tables succeeds. After 245: both are rejected on every table. No
 * posted->voided (or similarly adjustment-status) transition exists in
 * application code for fee_credit_notes/fee_write_offs (grepped
 * packages/backend/fees/src/*.ts: FeesService.issueCreditNote /
 * writeOffInvoice and PgFeesRepository only ever INSERT with
 * status='posted'), so there is no legitimate transition to preserve for
 * those two tables; staff_payroll_lines/staff_payroll_ledger_entries never
 * had one either (they are always children of an already-immutable posted
 * run).
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 083
 * (payroll) / 059 (fee adjustments). Optional MIGRATOR_DATABASE_URL
 * (table-owning role) is used to drop/restore 245's triggers for the red
 * phase; when unset, the red phase is skipped.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensurePgTestStudent, ensurePgTestStaff } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'payroll-fee-adjustment-immutability.live.test',
});
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL'];

const MIGRATION_245 = '245_payroll_fee_adjustment_immutability.sql';
const TRIGGERS = {
  staff_payroll_lines: 'trg_staff_payroll_lines_immutable',
  staff_payroll_ledger_entries: 'trg_staff_payroll_ledger_entries_immutable',
  fee_credit_notes: 'trg_fee_credit_notes_immutable',
  fee_write_offs: 'trg_fee_write_offs_immutable',
} as const;

function load245(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  return readFileSync(path.join(root, 'db/sql', MIGRATION_245), 'utf8');
}

describe.skipIf(!DATABASE_URL)('PRC-M201+M202 payroll/fee adjustment immutability (live)', () => {
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

  async function seedPayrollRun(client: pg.PoolClient): Promise<{
    tenantId: string;
    staffId: string;
    runId: string;
    lineId: string;
    ledgerId: string;
  }> {
    const tenantId = randomUUID();
    const staffId = randomUUID();
    const runId = randomUUID();
    const lineId = randomUUID();
    const ledgerId = randomUUID();
    await ensurePgTestStaff(pool, tenantId, staffId);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(
      `INSERT INTO staff_payroll_runs (
         id, tenant_id, month, status, gross_cents, deductions_cents, net_cents
       ) VALUES ($1, $2, '2026-01', 'posted', 10000, 1000, 9000)`,
      [runId, tenantId],
    );
    await client.query(
      `INSERT INTO staff_payroll_lines (
         id, tenant_id, run_id, staff_id, gross_cents, deductions_cents, net_cents
       ) VALUES ($1, $2, $3, $4, 10000, 1000, 9000)`,
      [lineId, tenantId, runId, staffId],
    );
    await client.query(
      `INSERT INTO staff_payroll_ledger_entries (
         id, tenant_id, run_id, journal_id, account, side, amount_cents
       ) VALUES ($1, $2, $3, $4, 'salary_expense', 'debit', 9000)`,
      [ledgerId, tenantId, runId, randomUUID()],
    );
    return { tenantId, staffId, runId, lineId, ledgerId };
  }

  async function seedFeeAdjustments(client: pg.PoolClient): Promise<{
    tenantId: string;
    studentId: string;
    invoiceId: string;
    creditNoteId: string;
    writeOffId: string;
  }> {
    const tenantId = randomUUID();
    const studentId = randomUUID();
    const invoiceId = randomUUID();
    const creditNoteId = randomUUID();
    const writeOffId = randomUUID();
    await ensurePgTestStudent(pool, tenantId, studentId);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(
      `INSERT INTO parent_fee_invoices (
         id, tenant_id, student_id, title, description, amount_cents, currency, status
       ) VALUES ($1, $2, $3, 'Adjustment immutability fixture', '', 10000, 'INR', 'open')`,
      [invoiceId, tenantId, studentId],
    );
    await client.query(
      `INSERT INTO fee_credit_notes (id, tenant_id, invoice_id, amount_cents, reason, status)
       VALUES ($1, $2, $3, 500, 'test credit', 'posted')`,
      [creditNoteId, tenantId, invoiceId],
    );
    await client.query(
      `INSERT INTO fee_write_offs (id, tenant_id, invoice_id, amount_cents, reason, status)
       VALUES ($1, $2, $3, 500, 'test write-off', 'posted')`,
      [writeOffId, tenantId, invoiceId],
    );
    return { tenantId, studentId, invoiceId, creditNoteId, writeOffId };
  }

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    'RED: without the triggers, UPDATE/DELETE on posted rows succeeds for all 4 tables',
    async () => {
      const m = migrator!;
      try {
        for (const [table, trigger] of Object.entries(TRIGGERS)) {
          await m.query(`DROP TRIGGER IF EXISTS ${trigger} ON ${table}`);
        }

        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const { lineId, ledgerId } = await seedPayrollRun(client);
          const { creditNoteId, writeOffId } = await seedFeeAdjustments(client);

          await client.query(`UPDATE staff_payroll_lines SET days_present = 99 WHERE id = $1`, [
            lineId,
          ]);
          await client.query(
            `UPDATE staff_payroll_ledger_entries SET memo = 'tampered' WHERE id = $1`,
            [ledgerId],
          );
          await client.query(`UPDATE fee_credit_notes SET reason = 'tampered' WHERE id = $1`, [
            creditNoteId,
          ]);
          await client.query(`UPDATE fee_write_offs SET reason = 'tampered' WHERE id = $1`, [
            writeOffId,
          ]);

          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      } finally {
        await m.query(load245());
      }
    },
  );

  it('GREEN: UPDATE on a posted staff_payroll_lines row is rejected', async () => {
    if (migrator) await migrator.query(load245());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { lineId } = await seedPayrollRun(client);
      await expect(
        client.query(`UPDATE staff_payroll_lines SET days_present = 99 WHERE id = $1`, [lineId]),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: DELETE on a posted staff_payroll_lines row is rejected', async () => {
    if (migrator) await migrator.query(load245());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { lineId } = await seedPayrollRun(client);
      await expect(
        client.query(`DELETE FROM staff_payroll_lines WHERE id = $1`, [lineId]),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: UPDATE/DELETE on staff_payroll_ledger_entries is rejected', async () => {
    if (migrator) await migrator.query(load245());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { ledgerId } = await seedPayrollRun(client);

      await client.query('SAVEPOINT sp_update');
      await expect(
        client.query(`UPDATE staff_payroll_ledger_entries SET memo = 'tampered' WHERE id = $1`, [
          ledgerId,
        ]),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK TO SAVEPOINT sp_update');

      await client.query('SAVEPOINT sp_delete');
      await expect(
        client.query(`DELETE FROM staff_payroll_ledger_entries WHERE id = $1`, [ledgerId]),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK TO SAVEPOINT sp_delete');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: UPDATE/DELETE on fee_credit_notes is rejected', async () => {
    if (migrator) await migrator.query(load245());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { creditNoteId } = await seedFeeAdjustments(client);

      await client.query('SAVEPOINT sp_update');
      await expect(
        client.query(`UPDATE fee_credit_notes SET reason = 'tampered' WHERE id = $1`, [
          creditNoteId,
        ]),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK TO SAVEPOINT sp_update');

      await client.query('SAVEPOINT sp_delete');
      await expect(
        client.query(`DELETE FROM fee_credit_notes WHERE id = $1`, [creditNoteId]),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK TO SAVEPOINT sp_delete');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('GREEN: UPDATE/DELETE on fee_write_offs is rejected', async () => {
    if (migrator) await migrator.query(load245());
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { writeOffId } = await seedFeeAdjustments(client);

      await client.query('SAVEPOINT sp_update');
      await expect(
        client.query(`UPDATE fee_write_offs SET reason = 'tampered' WHERE id = $1`, [writeOffId]),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK TO SAVEPOINT sp_update');

      await client.query('SAVEPOINT sp_delete');
      await expect(
        client.query(`DELETE FROM fee_write_offs WHERE id = $1`, [writeOffId]),
      ).rejects.toThrow(/append-only/i);
      await client.query('ROLLBACK TO SAVEPOINT sp_delete');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
