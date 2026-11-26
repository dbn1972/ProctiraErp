/**
 * PRC-M251 — live Postgres proof for bank reconciliation matching
 * (db/sql/330 + 331 and FeesService.importReconciliationCsv).
 *
 * Before: a line matched when its amount equalled the invoice face (partial
 * payments never matched; an unpaid invoice "matched"), nothing recorded which
 * payment a line confirmed, and re-importing a file made a second batch.
 * After: a line reconciles one succeeded payment of the same amount on the
 * invoice and stores payment_id; the key (UTR, amount, value date) and the
 * payment are reconciled once; the same file content returns the stored batch.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 331.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'reconciliation-matching.live.test' });
const pool = getSharedFeesPool();
const live = Boolean(DATABASE_URL) && pool !== null;
const rawPool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;

afterAll(async () => {
  await rawPool?.end();
});

async function setup() {
  const repo = new PgFeesRepository(pool!);
  const service = new FeesService(repo, new SandboxPaymentAdapter());
  const tenantId = randomUUID();
  const studentId = randomUUID();
  await ensurePgTestStudent(pool!, tenantId, studentId);
  const invoice = await service.createInvoice(tenantId, 'staff-1', {
    studentId,
    title: 'Term fee',
    amountCents: 5_000,
  });
  const first = await service.recordPayment(tenantId, 'parent-1', {
    invoiceId: invoice.id,
    method: 'upi',
    amountCents: 3_000,
  });
  const second = await service.recordPayment(tenantId, 'parent-1', {
    invoiceId: invoice.id,
    method: 'upi',
    amountCents: 2_000,
  });
  return { repo, service, tenantId, invoice, payments: [first.payment, second.payment] };
}

describe('PRC-M251 reconciliation matching (live)', () => {
  it.skipIf(!live)('reconciles bank lines to recorded payments, not the invoice face', async () => {
    const ctx = await setup();
    const n = ctx.invoice.invoiceNumber;
    const csv = [
      'invoiceNumber,amountCents,utr,valueDate',
      `${n},3000,UTR-001,2026-02-01`,
      `${n},2000,UTR-002,2026-02-02`,
      `${n},5000,UTR-003,2026-02-03`,
    ].join('\n');
    const imported = await ctx.service.importReconciliationCsv(ctx.tenantId, 'bursar-1', csv);
    expect(imported.idempotent).toBe(false);
    expect(imported.matched.map((m) => [m.amountCents, m.paymentId, m.bankReference])).toEqual([
      [3000, ctx.payments[0]!.id, 'UTR-001'],
      [2000, ctx.payments[1]!.id, 'UTR-002'],
    ]);
    expect(imported.unmatched.map((u) => [u.amountCents, u.note])).toEqual([
      [5000, 'no recorded payment of this amount on the invoice'],
    ]);
    const rows = await ctx.service.listReconciliationRows(ctx.tenantId, imported.batch.id);
    const stored = rows.find((r) => r.bankReference === 'UTR-001');
    expect([stored?.matched, stored?.paymentId, stored?.valueDate]).toEqual([
      true,
      ctx.payments[0]!.id,
      '2026-02-01',
    ]);
  });

  it.skipIf(!live)('returns the stored batch when the same file is imported again', async () => {
    const ctx = await setup();
    const csv = `invoiceNumber,amountCents,utr,valueDate\n${ctx.invoice.invoiceNumber},3000,UTR-9,2026-02-01`;
    const first = await ctx.service.importReconciliationCsv(ctx.tenantId, 'bursar-1', csv);
    const again = await ctx.service.importReconciliationCsv(
      ctx.tenantId,
      'bursar-2',
      `\n  ${csv.replace('\n', '\r\n')}  \n`,
      'renamed.csv',
    );
    expect(again.idempotent).toBe(true);
    expect(again.batch.id).toBe(first.batch.id);
    expect(again.matched.map((m) => m.paymentId)).toEqual([ctx.payments[0]!.id]);
    expect(await ctx.service.listReconciliationBatches(ctx.tenantId)).toHaveLength(1);
  });

  it.skipIf(!live)('reconciles a payment and a bank line once across imports', async () => {
    const ctx = await setup();
    const n = ctx.invoice.invoiceNumber;
    await ctx.service.importReconciliationCsv(
      ctx.tenantId,
      'bursar-1',
      `invoiceNumber,amountCents,utr,valueDate\n${n},3000,UTR-A,2026-02-01`,
    );
    const later = await ctx.service.importReconciliationCsv(
      ctx.tenantId,
      'bursar-1',
      [
        'invoiceNumber,amountCents,utr,valueDate',
        `${n},3000,UTR-A,2026-02-01`,
        `${n},3000,UTR-B,2026-02-05`,
        `${n},2000,UTR-C,2026-02-06`,
      ].join('\n'),
    );
    expect(later.unmatched.map((u) => [u.bankReference, u.note])).toEqual([
      ['UTR-A', 'bank line already reconciled'],
      ['UTR-B', 'payment already reconciled'],
    ]);
    expect(later.matched.map((m) => [m.bankReference, m.paymentId])).toEqual([
      ['UTR-C', ctx.payments[1]!.id],
    ]);
  });

  it.skipIf(!live)(
    'the database refuses a second match for a payment or a match without one',
    async () => {
      const ctx = await setup();
      const imported = await ctx.service.importReconciliationCsv(
        ctx.tenantId,
        'bursar-1',
        `invoiceNumber,amountCents\n${ctx.invoice.invoiceNumber},3000`,
      );
      const client = await rawPool!.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [ctx.tenantId]);
        const insert = (paymentId: string | null) =>
          client.query(
            `INSERT INTO fee_reconciliation_rows (
             id, tenant_id, batch_id, invoice_number, amount_cents, matched, invoice_id, payment_id
           ) VALUES ($1, $2, $3, 'X', 3000, true, $4, $5)`,
            [randomUUID(), ctx.tenantId, imported.batch.id, ctx.invoice.id, paymentId],
          );
        await client.query('SAVEPOINT s1');
        await expect(insert(ctx.payments[0]!.id)).rejects.toMatchObject({
          code: '23505',
          constraint: 'fee_reconciliation_rows_payment_uidx',
        });
        await client.query('ROLLBACK TO SAVEPOINT s1');
        await expect(insert(null)).rejects.toMatchObject({ code: '23514' });
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    },
  );
});
