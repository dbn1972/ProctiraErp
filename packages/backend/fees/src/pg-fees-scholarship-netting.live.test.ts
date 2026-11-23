/**
 * F-D1 / F-D2 live Postgres proof (runtime role proctira_app): scholarship netting credits
 * the verified disbursement amount in exact paise against ad-hoc, plan and structure
 * invoices, applies at most the invoice's open amount, keeps the remainder on the
 * disbursement for the next open invoice, never nets the same money twice (replay or
 * concurrent calls), and writes one keyed audit row per netting inside the money
 * transaction. Skips without DATABASE_URL (requireLiveDatabaseUrl fails in CI when a live
 * DB is required but missing).
 */
import { randomUUID } from 'node:crypto';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';
import { buildSystemMoneyAuditSink } from './fees-plugin.js';
import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-fees-scholarship-netting.live.test' });
const pool = getSharedFeesPool();
const live = Boolean(DATABASE_URL) && pool !== null;

async function setup() {
  const repo = new PgFeesRepository(pool!);
  const service = new FeesService(repo, new SandboxPaymentAdapter());
  const tenantId = randomUUID();
  const studentId = randomUUID();
  await ensurePgTestStudent(pool!, tenantId, studentId);
  const audit = buildSystemMoneyAuditSink(tenantId, {
    userId: 'scholarship-netting',
    source: 'scholarship.disbursement.paid',
  });
  return { repo, service, tenantId, studentId, audit };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

async function structureInvoice(ctx: Ctx, amountCents: number) {
  const structure = await ctx.service.createFeeStructure(ctx.tenantId, 'staff-1', {
    name: `Tuition ${amountCents}`,
    category: 'tuition',
    amountCents,
  });
  const { created } = await ctx.service.bulkInvoiceClass(ctx.tenantId, 'staff-1', {
    structureId: structure.id,
    studentIds: [ctx.studentId],
  });
  return created[0]!;
}

async function nettingRows(ctx: Ctx, disbursementId: string) {
  return withPgTenant(pool!, ctx.tenantId, async (client) => {
    const res = await client.query(
      `SELECT id, invoice_id, amount_cents, status FROM fee_concessions
        WHERE tenant_id = $1 AND source_disbursement_id = $2 ORDER BY created_at`,
      [ctx.tenantId, disbursementId],
    );
    return res.rows as Array<{
      id: string;
      invoice_id: string | null;
      amount_cents: number;
      status: string;
    }>;
  });
}

async function nettingAuditRows(ctx: Ctx) {
  return withPgTenant(pool!, ctx.tenantId, async (client) => {
    const res = await client.query(
      `SELECT entity_id, metadata, after_values FROM audit_log_entries
        WHERE tenant_id = $1 AND metadata->>'regulated' = 'fees.scholarship_netting'
        ORDER BY chain_seq`,
      [ctx.tenantId],
    );
    return res.rows as Array<{
      entity_id: string;
      metadata: Record<string, unknown>;
      after_values: Record<string, unknown> | null;
    }>;
  });
}

async function face(ctx: Ctx, invoiceId: string) {
  return (await ctx.service.getInvoice(ctx.tenantId, invoiceId)).amountCents;
}

describe('PgFeesRepository scholarship netting credit (live, F-D1/F-D2)', () => {
  it.skipIf(!live)('ad-hoc invoice: ₹2,000.00 − ₹500.25 = ₹1,499.75, audited', async () => {
    const ctx = await setup();
    const invoice = await ctx.service.createInvoice(ctx.tenantId, 'staff-1', {
      studentId: ctx.studentId,
      title: 'Ad-hoc',
      amountCents: 200_000,
    });
    const disbursementId = randomUUID();
    const result = await ctx.service.applyScholarshipNetting(
      ctx.tenantId,
      'scholarship-netting',
      { studentId: ctx.studentId, disbursementId, amountCents: 50_025 },
      ctx.audit,
    );
    expect(result.discountCents).toBe(50_025);
    expect(result.remainingCents).toBe(0);
    expect(await face(ctx, invoice.id)).toBe(149_975);
    const rows = await nettingRows(ctx, disbursementId);
    expect(rows.map((r) => [r.invoice_id, Number(r.amount_cents), r.status])).toEqual([
      [invoice.id, 50_025, 'approved'],
    ]);
    const audits = await nettingAuditRows(ctx);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.entity_id).toBe(rows[0]!.id);
    const tb = await ctx.service.getTrialBalance(ctx.tenantId);
    expect(tb.debitCents).toBe(tb.creditCents);
  });

  it.skipIf(!live)('plan invoice: credits the exact paise amount', async () => {
    const ctx = await setup();
    const plan = await ctx.service.createFeePlan(ctx.tenantId, 'staff-1', {
      name: `Plan ${randomUUID().slice(0, 8)}`,
      amountCents: 120_000,
    });
    const invoice = await ctx.service.createInvoice(ctx.tenantId, 'staff-1', {
      studentId: ctx.studentId,
      planId: plan.id,
    });
    const result = await ctx.service.applyScholarshipNetting(
      ctx.tenantId,
      'scholarship-netting',
      { studentId: ctx.studentId, disbursementId: randomUUID(), amountCents: 33_325 },
      ctx.audit,
    );
    expect(result.discountCents).toBe(33_325);
    expect(await face(ctx, invoice.id)).toBe(86_675);
  });

  it.skipIf(!live)('structure invoice: credits the exact paise amount (.25)', async () => {
    const ctx = await setup();
    const invoice = await structureInvoice(ctx, 100_000);
    const result = await ctx.service.applyScholarshipNetting(
      ctx.tenantId,
      'scholarship-netting',
      { studentId: ctx.studentId, disbursementId: randomUUID(), amountCents: 25_025 },
      ctx.audit,
    );
    expect(result.discountCents).toBe(25_025);
    expect(await face(ctx, invoice.id)).toBe(74_975);
  });

  it.skipIf(!live)(
    'excess: ₹1,500 on a ₹1,000 invoice applies ₹1,000 and carries ₹500 to the next invoice',
    async () => {
      const ctx = await setup();
      const first = await structureInvoice(ctx, 100_000);
      const disbursementId = randomUUID();
      const input = { studentId: ctx.studentId, disbursementId, amountCents: 150_000 };
      const applied = await ctx.service.applyScholarshipNetting(
        ctx.tenantId,
        'scholarship-netting',
        input,
        ctx.audit,
      );
      expect(applied.discountCents).toBe(100_000);
      expect(applied.nettedCents).toBe(100_000);
      expect(applied.remainingCents).toBe(50_000);
      const settled = await ctx.service.getInvoice(ctx.tenantId, first.id);
      expect(settled.amountCents).toBe(0);
      expect(settled.status).toBe('paid');

      const replay = await ctx.service.applyScholarshipNetting(
        ctx.tenantId,
        'scholarship-netting',
        input,
        ctx.audit,
      );
      expect(replay.idempotent).toBe(true);
      expect(replay.discountCents).toBe(100_000);
      expect(replay.remainingCents).toBe(50_000);

      const second = await ctx.service.createInvoice(ctx.tenantId, 'staff-1', {
        studentId: ctx.studentId,
        title: 'Transport',
        amountCents: 80_000,
      });
      const carried = await ctx.service.applyScholarshipNetting(
        ctx.tenantId,
        'scholarship-netting',
        input,
        ctx.audit,
      );
      expect(carried.invoice?.id).toBe(second.id);
      expect(carried.discountCents).toBe(50_000);
      expect(carried.remainingCents).toBe(0);
      expect(await face(ctx, second.id)).toBe(30_000);

      const rows = await nettingRows(ctx, disbursementId);
      expect(rows.map((r) => [r.invoice_id, Number(r.amount_cents)])).toEqual([
        [first.id, 100_000],
        [second.id, 50_000],
      ]);
      const audits = await nettingAuditRows(ctx);
      expect(audits.map((a) => a.entity_id)).toEqual(rows.map((r) => r.id));
      const tb = await ctx.service.getTrialBalance(ctx.tenantId);
      expect(tb.debitCents).toBe(tb.creditCents);
    },
  );

  it.skipIf(!live)('double netting of a fully netted disbursement is a no-op replay', async () => {
    const ctx = await setup();
    const invoice = await ctx.service.createInvoice(ctx.tenantId, 'staff-1', {
      studentId: ctx.studentId,
      title: 'Ad-hoc',
      amountCents: 200_000,
    });
    const other = await ctx.service.createInvoice(ctx.tenantId, 'staff-1', {
      studentId: ctx.studentId,
      title: 'Second open invoice',
      amountCents: 200_000,
    });
    const input = { studentId: ctx.studentId, disbursementId: randomUUID(), amountCents: 50_025 };
    await ctx.service.applyScholarshipNetting(ctx.tenantId, 'n', input, ctx.audit);
    const second = await ctx.service.applyScholarshipNetting(ctx.tenantId, 'n', input, ctx.audit);
    expect(second.idempotent).toBe(true);
    expect(second.discountCents).toBe(50_025);
    expect(await nettingRows(ctx, input.disbursementId)).toHaveLength(1);
    // The second open invoice is not credited again.
    expect((await face(ctx, invoice.id)) + (await face(ctx, other.id))).toBe(400_000 - 50_025);
    expect(await nettingAuditRows(ctx)).toHaveLength(1);
  });

  it.skipIf(!live)(
    'concurrent nettings of one disbursement across two open invoices credit it exactly once',
    async () => {
      const ctx = await setup();
      const a = await ctx.service.createInvoice(ctx.tenantId, 'staff-1', {
        studentId: ctx.studentId,
        title: 'A',
        amountCents: 40_000,
      });
      const b = await ctx.service.createInvoice(ctx.tenantId, 'staff-1', {
        studentId: ctx.studentId,
        title: 'B',
        amountCents: 40_000,
      });
      const input = {
        studentId: ctx.studentId,
        disbursementId: randomUUID(),
        amountCents: 50_025,
      };
      const settled = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          ctx.service.applyScholarshipNetting(ctx.tenantId, 'n', input, ctx.audit),
        ),
      );
      const rejected = settled.filter((s) => s.status === 'rejected');
      expect(rejected.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
      const rows = await nettingRows(ctx, input.disbursementId);
      expect(rows.reduce((sum, r) => sum + Number(r.amount_cents), 0)).toBe(50_025);
      expect((await face(ctx, a.id)) + (await face(ctx, b.id))).toBe(80_000 - 50_025);
      expect(await nettingAuditRows(ctx)).toHaveLength(rows.length);
      const tb = await ctx.service.getTrialBalance(ctx.tenantId);
      expect(tb.debitCents).toBe(tb.creditCents);
    },
  );
});
