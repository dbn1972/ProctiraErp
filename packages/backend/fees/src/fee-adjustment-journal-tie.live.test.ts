/**
 * PRC-M202 — live Postgres proof that fee adjustments are tied to the ledger
 * journal that posted them, and that refunds and concessions are immutable
 * once posted (db/sql/321).
 *
 * Before 321: adjustment rows have no journal_id, a posted credit note commits
 * with no journal, and fee_refunds / fee_concessions rows can be edited or
 * deleted. After 321: FeesService writes the journal id on the adjustment and
 * on its ledger legs; the database refuses a posted adjustment without a
 * journal, a journal id that does not exist for the invoice or whose amount
 * differs, and any edit/delete outside the service's state moves.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 321.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'fee-adjustment-journal-tie.live.test' });
const pool = getSharedFeesPool();
const live = Boolean(DATABASE_URL) && pool !== null;
const rawPool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;

afterAll(async () => {
  await rawPool?.end();
});

async function setup(amountCents = 10_000) {
  const repo = new PgFeesRepository(pool!);
  const service = new FeesService(repo, new SandboxPaymentAdapter());
  const tenantId = randomUUID();
  const studentId = randomUUID();
  await ensurePgTestStudent(pool!, tenantId, studentId);
  const structure = await service.createFeeStructure(tenantId, 'staff-1', {
    name: 'Tuition',
    category: 'tuition',
    amountCents,
  });
  const { created } = await service.bulkInvoiceClass(tenantId, 'staff-1', {
    structureId: structure.id,
    studentIds: [studentId],
  });
  return { repo, service, tenantId, studentId, structure, invoice: created[0]! };
}

async function journalLegs(tenantId: string, journalId: string) {
  const client = await rawPool!.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const { rows } = await client.query<{ invoice_id: string; side: string; amount: string }>(
      `SELECT invoice_id, side, amount_cents::text AS amount FROM fee_ledger_entries
        WHERE tenant_id = $1 AND journal_id = $2 ORDER BY side`,
      [tenantId, journalId],
    );
    await client.query('COMMIT');
    return rows;
  } finally {
    client.release();
  }
}

async function inTenant<T>(tenantId: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await rawPool!.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

describe('PRC-M202 fee adjustment journal tie (live)', () => {
  it.skipIf(!live)(
    'credit note, write-off, refund and concession carry their journal id',
    async () => {
      const ctx = await setup();
      const { creditNote } = await ctx.service.issueCreditNote(ctx.tenantId, 'bursar-1', {
        invoiceId: ctx.invoice.id,
        amountCents: 1_000,
        reason: 'sibling discount',
      });
      const { writeOff } = await ctx.service.writeOffInvoice(ctx.tenantId, 'bursar-1', {
        invoiceId: ctx.invoice.id,
        amountCents: 500,
        reason: 'uncollectible',
      });
      const created = await ctx.service.applyConcession(ctx.tenantId, 'clerk-1', {
        studentId: ctx.studentId,
        structureId: ctx.structure.id,
        invoiceId: ctx.invoice.id,
        kind: 'amount',
        amountCents: 700,
        reason: 'hardship',
      });
      const approved = await ctx.service.approveConcession(
        ctx.tenantId,
        'bursar-2',
        created.concession.id,
      );
      await ctx.service.recordPayment(ctx.tenantId, 'parent-1', {
        invoiceId: ctx.invoice.id,
        method: 'sandbox',
      });
      const refund = await ctx.service.recordRefund(ctx.tenantId, 'bursar-1', {
        invoiceId: ctx.invoice.id,
        amountCents: 300,
        reason: 'overcharge',
      });

      for (const [row, amount] of [
        [creditNote, '1000'],
        [writeOff, '500'],
        [refund, '300'],
        [approved.concession, '700'],
      ] as const) {
        expect(row.journalId).toMatch(/^[0-9a-f-]{36}$/);
        const legs = await journalLegs(ctx.tenantId, row.journalId!);
        expect(legs.map((l) => [l.invoice_id, l.side, l.amount])).toEqual([
          [ctx.invoice.id, 'credit', amount],
          [ctx.invoice.id, 'debit', amount],
        ]);
      }
      const reread = await ctx.repo.findConcessionById(created.concession.id, ctx.tenantId);
      expect(reread?.journalId).toBe(approved.concession.journalId);
    },
  );

  it.skipIf(!live)('a posted credit note without a journal id is rejected', async () => {
    const ctx = await setup();
    await inTenant(ctx.tenantId, async (c) => {
      await expect(
        c.query(
          `INSERT INTO fee_credit_notes (id, tenant_id, invoice_id, amount_cents, reason, status)
           VALUES ($1, $2, $3, 100, 'no journal', 'posted')`,
          [randomUUID(), ctx.tenantId, ctx.invoice.id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it.skipIf(!live)('a refund naming a journal that was never posted fails at COMMIT', async () => {
    const ctx = await setup();
    const paid = await ctx.service.recordPayment(ctx.tenantId, 'parent-1', {
      invoiceId: ctx.invoice.id,
      method: 'sandbox',
    });
    const client = await rawPool!.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantId]);
      await client.query(
        `INSERT INTO fee_refunds (id, tenant_id, invoice_id, payment_id, amount_cents, reason, status, journal_id)
         VALUES ($1, $2, $3, $4, 100, 'orphan journal', 'posted', $5)`,
        [randomUUID(), ctx.tenantId, ctx.invoice.id, paid.payment.id, randomUUID()],
      );
      await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23503' });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it.skipIf(!live)(
    'a write-off whose amount differs from its journal fails at COMMIT',
    async () => {
      const ctx = await setup();
      const client = await rawPool!.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantId]);
        const journalId = randomUUID();
        await client.query(
          `INSERT INTO fee_ledger_entries (tenant_id, journal_id, invoice_id, account, side, amount_cents, currency)
         VALUES ($1, $2, $3, 'bad_debt_expense', 'debit', 200, 'INR'),
                ($1, $2, $3, 'accounts_receivable', 'credit', 200, 'INR')`,
          [ctx.tenantId, journalId, ctx.invoice.id],
        );
        await client.query(
          `INSERT INTO fee_write_offs (id, tenant_id, invoice_id, amount_cents, reason, status, journal_id)
         VALUES ($1, $2, $3, 900, 'amount drift', 'posted', $4)`,
          [randomUUID(), ctx.tenantId, ctx.invoice.id, journalId],
        );
        await expect(client.query('COMMIT')).rejects.toMatchObject({ code: '23000' });
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    },
  );

  it.skipIf(!live)('a posted refund cannot be edited or deleted', async () => {
    const ctx = await setup();
    await ctx.service.recordPayment(ctx.tenantId, 'parent-1', {
      invoiceId: ctx.invoice.id,
      method: 'sandbox',
    });
    const refund = await ctx.service.recordRefund(ctx.tenantId, 'bursar-1', {
      invoiceId: ctx.invoice.id,
      amountCents: 400,
      reason: 'overcharge',
    });
    await inTenant(ctx.tenantId, async (c) => {
      await c.query('SAVEPOINT s1');
      await expect(
        c.query(`UPDATE fee_refunds SET amount_cents = 1 WHERE id = $1`, [refund.id]),
      ).rejects.toThrow(/append-only/i);
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expect(c.query(`DELETE FROM fee_refunds WHERE id = $1`, [refund.id])).rejects.toThrow(
        /append-only/i,
      );
    });
  });

  it.skipIf(!live)(
    'an approved concession keeps its terms; only the reversal move remains',
    async () => {
      const ctx = await setup();
      const created = await ctx.service.applyConcession(ctx.tenantId, 'clerk-1', {
        studentId: ctx.studentId,
        structureId: ctx.structure.id,
        invoiceId: ctx.invoice.id,
        kind: 'amount',
        amountCents: 600,
        reason: 'hardship',
      });
      await ctx.service.approveConcession(ctx.tenantId, 'bursar-2', created.concession.id);
      const id = created.concession.id;
      await inTenant(ctx.tenantId, async (c) => {
        const attempts = [
          `UPDATE fee_concessions SET amount_cents = 60000 WHERE id = $1`,
          `UPDATE fee_concessions SET status = 'pending' WHERE id = $1`,
          `UPDATE fee_concessions SET approver_id = 'someone-else' WHERE id = $1`,
          `UPDATE fee_concessions SET journal_id = gen_random_uuid() WHERE id = $1`,
          `DELETE FROM fee_concessions WHERE id = $1`,
        ];
        for (const [i, sql] of attempts.entries()) {
          await c.query(`SAVEPOINT a${i}`);
          await expect(c.query(sql, [id])).rejects.toMatchObject({ code: '23000' });
          await c.query(`ROLLBACK TO SAVEPOINT a${i}`);
        }
        const ok = await c.query(`UPDATE fee_concessions SET status = 'rejected' WHERE id = $1`, [
          id,
        ]);
        expect(ok.rowCount).toBe(1);
      });
    },
  );
});
