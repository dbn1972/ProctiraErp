/**
 * Pg fees repository — restart-safe persistence via shared mock pool (G-201).
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { FeesService } from './fees-service.js';
import { PgFeesRepository, type PgPoolLike } from './pg-fees-repository.js';

type Row = Record<string, unknown>;

function createMockFeesPool(): PgPoolLike {
  const plans: Row[] = [];
  const invoices: Row[] = [];
  const payments: Row[] = [];
  const receipts: Row[] = [];
  const now = () => new Date();

  async function query(text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> {
    const sql = text.replace(/\s+/g, ' ').trim();

    if (/^SELECT set_config/i.test(sql) || /^BEGIN$/i.test(sql) || /^COMMIT$/i.test(sql)) {
      return { rows: [] };
    }
    if (/CREATE TABLE|ALTER TABLE|CREATE INDEX/i.test(sql)) {
      return { rows: [] };
    }

    if (/INSERT INTO parent_fee_plans/i.test(sql)) {
      const row: Row = {
        id: values[0],
        tenant_id: values[1],
        code: values[2],
        name: values[3],
        description: values[4],
        amount_cents: values[5],
        currency: values[6],
        frequency: values[7],
        status: values[8],
        created_by: values[9],
        created_at: now(),
        updated_at: now(),
      };
      plans.push(row);
      return { rows: [row] };
    }

    if (/INSERT INTO parent_fee_invoices/i.test(sql)) {
      const row: Row = {
        id: values[0],
        tenant_id: values[1],
        student_id: values[2],
        plan_id: values[3],
        title: values[4],
        description: values[5],
        amount_cents: values[6],
        currency: values[7],
        status: values[8],
        due_at: values[9],
        created_by: values[10],
        created_at: now(),
        updated_at: now(),
      };
      invoices.push(row);
      return { rows: [row] };
    }

    if (/INSERT INTO parent_fee_payments/i.test(sql)) {
      const row: Row = {
        id: values[0],
        invoice_id: values[1],
        tenant_id: values[2],
        payer_user_id: values[3],
        amount_cents: values[4],
        method: values[5],
        status: values[6],
        paid_at: values[7],
        created_at: now(),
      };
      payments.push(row);
      return { rows: [row] };
    }

    if (/INSERT INTO parent_fee_receipts/i.test(sql)) {
      const row: Row = {
        id: values[0],
        tenant_id: values[1],
        payment_id: values[2],
        invoice_id: values[3],
        receipt_number: values[4],
        amount_cents: values[5],
        currency: values[6],
        issued_at: values[7],
        created_at: now(),
      };
      receipts.push(row);
      return { rows: [row] };
    }

    if (/UPDATE parent_fee_invoices/i.test(sql)) {
      const status = values[0];
      const id = values[1];
      const tenantId = values[2];
      const idx = invoices.findIndex((row) => row.id === id && row.tenant_id === tenantId);
      if (idx < 0) return { rows: [] };
      invoices[idx] = { ...invoices[idx]!, status, updated_at: now() };
      return { rows: [invoices[idx]!] };
    }

    if (/SELECT \* FROM parent_fee_invoices WHERE id/i.test(sql)) {
      const row = invoices.find((i) => i.id === values[0] && i.tenant_id === values[1]);
      return { rows: row ? [row] : [] };
    }

    if (/SELECT \* FROM parent_fee_invoices WHERE tenant_id/i.test(sql)) {
      return { rows: invoices.filter((i) => i.tenant_id === values[0]) };
    }

    if (/SELECT \* FROM parent_fee_payments WHERE tenant_id/i.test(sql)) {
      return { rows: payments.filter((p) => p.tenant_id === values[0]) };
    }

    if (/SELECT \* FROM parent_fee_receipts WHERE tenant_id/i.test(sql)) {
      return { rows: receipts.filter((r) => r.tenant_id === values[0]) };
    }

    if (/SELECT \* FROM parent_fee_receipts WHERE id/i.test(sql)) {
      const row = receipts.find((r) => r.id === values[0] && r.tenant_id === values[1]);
      return { rows: row ? [row] : [] };
    }

    return { rows: [] };
  }

  return {
    query: query as PgPoolLike['query'],
    end: async () => undefined,
  };
}

describe('PgFeesRepository restart-safe (mock pool)', () => {
  it('survives repository restart: payment + receipt still total invoice amount', async () => {
    const pool = createMockFeesPool();
    const tenantId = randomUUID();
    const studentId = randomUUID();

    const repo1 = new PgFeesRepository(pool, { ensureSchema: false });
    const service1 = new FeesService(repo1);

    const invoice = await service1.createInvoice(tenantId, 'staff-1', {
      studentId,
      title: 'Term fee',
      amountCents: 125_000,
      currency: 'INR',
    });

    const { payment, receipt } = await service1.recordPayment(tenantId, 'staff-1', {
      invoiceId: invoice.id,
      method: 'sandbox',
    });

    expect(payment.amountCents).toBe(125_000);
    expect(receipt.amountCents).toBe(125_000);

    const repo2 = new PgFeesRepository(pool, { ensureSchema: false });
    const service2 = new FeesService(repo2);

    const invoices = await service2.listInvoices(tenantId);
    const payments = await service2.listPayments(tenantId);
    const receipts = await service2.listReceipts(tenantId);

    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.status).toBe('paid');
    expect(invoices[0]!.amountCents).toBe(125_000);

    expect(payments).toHaveLength(1);
    expect(payments[0]!.id).toBe(payment.id);
    expect(payments[0]!.amountCents).toBe(125_000);

    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.id).toBe(receipt.id);
    expect(receipts[0]!.paymentId).toBe(payment.id);
    expect(receipts[0]!.amountCents).toBe(invoices[0]!.amountCents);
    expect(receipts[0]!.amountCents).toBe(payments[0]!.amountCents);
  });
});
