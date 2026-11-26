/**
 * PRC-M503 — live Postgres proof for parent_fee_payments integrity
 * (db/sql/322 + 323).
 *
 * Before: an INSERT without method/status became a settled 'sandbox'
 * payment, succeeded payments could exceed the invoice, the face could be cut
 * below cash collected, and a provider transaction id had no provider and no
 * uniqueness. After: method/status are required, the overpayment guard raises
 * 23514 (parent_fee_payments_within_invoice), a provider txn id needs a
 * provider, and (tenant, provider, provider_txn_id) is unique.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 323.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'fee-payment-integrity.live.test' });
const pool = getSharedFeesPool();
const live = Boolean(DATABASE_URL) && pool !== null;
const rawPool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;

afterAll(async () => {
  await rawPool?.end();
});

async function withInvoice(
  amountCents: number,
  fn: (c: pg.PoolClient, ids: { tenantId: string; invoiceId: string }) => Promise<void>,
): Promise<void> {
  const tenantId = randomUUID();
  const studentId = randomUUID();
  const invoiceId = randomUUID();
  await ensurePgTestStudent(rawPool!, tenantId, studentId);
  const client = await rawPool!.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(
      `INSERT INTO parent_fee_invoices (
         id, tenant_id, student_id, title, description, amount_cents, currency, status
       ) VALUES ($1, $2, $3, 'Payment integrity fixture', '', $4, 'INR', 'open')`,
      [invoiceId, tenantId, studentId, amountCents],
    );
    await fn(client, { tenantId, invoiceId });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

function pay(
  c: pg.PoolClient,
  ids: { tenantId: string; invoiceId: string },
  amountCents: number,
  status = 'succeeded',
) {
  return c.query(
    `INSERT INTO parent_fee_payments (id, invoice_id, tenant_id, payer_user_id, amount_cents, method, status)
     VALUES ($1, $2, $3, 'payer', $4, 'cash', $5) RETURNING id`,
    [randomUUID(), ids.invoiceId, ids.tenantId, amountCents, status],
  );
}

describe('PRC-M503 fee payment integrity (live)', () => {
  it.skipIf(!live)('a payment without method or status is rejected, not defaulted', async () => {
    await withInvoice(1_000, async (c, ids) => {
      await c.query('SAVEPOINT s1');
      await expect(
        c.query(
          `INSERT INTO parent_fee_payments (id, invoice_id, tenant_id, payer_user_id, amount_cents, status)
           VALUES ($1, $2, $3, 'payer', 100, 'succeeded')`,
          [randomUUID(), ids.invoiceId, ids.tenantId],
        ),
      ).rejects.toMatchObject({ code: '23502' });
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expect(
        c.query(
          `INSERT INTO parent_fee_payments (id, invoice_id, tenant_id, payer_user_id, amount_cents, method)
           VALUES ($1, $2, $3, 'payer', 100, 'cash')`,
          [randomUUID(), ids.invoiceId, ids.tenantId],
        ),
      ).rejects.toMatchObject({ code: '23502' });
    });
  });

  it.skipIf(!live)('succeeded payments cannot exceed the invoice amount', async () => {
    await withInvoice(1_000, async (c, ids) => {
      await pay(c, ids, 600);
      await c.query('SAVEPOINT s1');
      await expect(pay(c, ids, 401)).rejects.toMatchObject({
        code: '23514',
        constraint: 'parent_fee_payments_within_invoice',
      });
      await c.query('ROLLBACK TO SAVEPOINT s1');
      // A pending payment does not count until it succeeds.
      const pending = await pay(c, ids, 900, 'pending');
      await c.query('SAVEPOINT s2');
      await expect(
        c.query(`UPDATE parent_fee_payments SET status = 'succeeded' WHERE id = $1`, [
          pending.rows[0].id,
        ]),
      ).rejects.toMatchObject({ code: '23514' });
      await c.query('ROLLBACK TO SAVEPOINT s2');
      await pay(c, ids, 400);
    });
  });

  it.skipIf(!live)('the invoice amount cannot be cut below cash collected', async () => {
    await withInvoice(1_000, async (c, ids) => {
      await pay(c, ids, 700);
      await c.query('SAVEPOINT s1');
      await expect(
        c.query(`UPDATE parent_fee_invoices SET amount_cents = 699 WHERE id = $1`, [ids.invoiceId]),
      ).rejects.toMatchObject({ code: '23514' });
      await c.query('ROLLBACK TO SAVEPOINT s1');
      const ok = await c.query(`UPDATE parent_fee_invoices SET amount_cents = 700 WHERE id = $1`, [
        ids.invoiceId,
      ]);
      expect(ok.rowCount).toBe(1);
    });
  });

  it.skipIf(!live)('a provider transaction needs a provider and is recorded once', async () => {
    await withInvoice(1_000, async (c, ids) => {
      const insert = (provider: string | null, txn: string) =>
        c.query(
          `INSERT INTO parent_fee_payments (
             id, invoice_id, tenant_id, payer_user_id, amount_cents, method, status,
             provider, provider_txn_id
           ) VALUES ($1, $2, $3, 'payer', 100, 'upi', 'succeeded', $4, $5)`,
          [randomUUID(), ids.invoiceId, ids.tenantId, provider, txn],
        );
      await c.query('SAVEPOINT s1');
      await expect(insert(null, 'pay_123')).rejects.toMatchObject({ code: '23514' });
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await insert('razorpay', 'pay_123');
      await c.query('SAVEPOINT s2');
      await expect(insert('razorpay', 'pay_123')).rejects.toMatchObject({ code: '23505' });
      await c.query('ROLLBACK TO SAVEPOINT s2');
      await insert('cashfree', 'pay_123');
    });
  });

  it.skipIf(!live)('FeesService still settles an invoice in full', async () => {
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
    const paid = await service.recordPayment(tenantId, 'parent-1', {
      invoiceId: invoice.id,
      method: 'sandbox',
    });
    expect(paid.payment.amountCents).toBe(5_000);
    expect(paid.invoice.status).toBe('paid');
  });
});
