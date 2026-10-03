/**
 * Live Postgres proof for PRC-L306: concession approve/reject and scholarship
 * netting run their audit on the open money transaction. A failing audit append
 * rolls back the status flip, the invoice face update, the concession row and the
 * journal. Skips without DATABASE_URL (requireLiveDatabaseUrl fails in CI when a
 * live DB is required but missing).
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';
import type { FeesMoneyAuditSink } from './fees-repository.js';
import { FeesService } from './fees-service.js';
import { SandboxPaymentAdapter } from './payment-adapter.js';
import { getSharedFeesPool, PgFeesRepository } from './pg-fees-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-fees-concession-audit.live.test' });
const pool = getSharedFeesPool();
const live = Boolean(DATABASE_URL) && pool !== null;

const failingAudit: FeesMoneyAuditSink = async (tx) => {
  // Prove the sink runs on the transaction-bound client, then fail like a broken audit append.
  expect(tx.transactionClient?.()).toBeTruthy();
  throw new Error('audit append failed');
};

describe('PgFeesRepository concession/netting audit rollback (live, PRC-L306)', () => {
  async function setup() {
    const repo = new PgFeesRepository(pool!);
    const service = new FeesService(repo, new SandboxPaymentAdapter());
    const tenantId = randomUUID();
    const studentId = randomUUID();
    await ensurePgTestStudent(pool!, tenantId, studentId);
    const structure = await service.createFeeStructure(tenantId, 'staff-1', {
      name: 'Tuition',
      category: 'tuition',
      amountCents: 10_000,
    });
    // Billed from the structure so concession + netting target the same invoice.
    const { created } = await service.bulkInvoiceClass(tenantId, 'staff-1', {
      structureId: structure.id,
      studentIds: [studentId],
    });
    const invoice = created[0]!;
    return { repo, service, tenantId, studentId, structure, invoice };
  }

  async function pending(ctx: Awaited<ReturnType<typeof setup>>) {
    const created = await ctx.service.applyConcession(ctx.tenantId, 'clerk-1', {
      studentId: ctx.studentId,
      structureId: ctx.structure.id,
      invoiceId: ctx.invoice.id,
      kind: 'amount',
      amountCents: 2_000,
      reason: 'hardship',
    });
    return created.concession;
  }

  it.skipIf(!live)('approve: audit failure rolls back status, face and journal', async () => {
    const ctx = await setup();
    const concession = await pending(ctx);
    const legsBefore = (await ctx.service.getInvoiceLedger(ctx.tenantId, ctx.invoice.id)).length;
    await expect(
      ctx.service.approveConcession(ctx.tenantId, 'bursar-1', concession.id, failingAudit),
    ).rejects.toThrow('audit append failed');
    expect((await ctx.repo.findConcessionById(concession.id, ctx.tenantId))?.status).toBe(
      'pending',
    );
    expect((await ctx.service.getInvoice(ctx.tenantId, ctx.invoice.id)).amountCents).toBe(10_000);
    expect((await ctx.service.getInvoiceLedger(ctx.tenantId, ctx.invoice.id)).length).toBe(
      legsBefore,
    );
  });

  it.skipIf(!live)('reject: audit failure leaves the concession pending', async () => {
    const ctx = await setup();
    const concession = await pending(ctx);
    await expect(
      ctx.service.rejectConcession(ctx.tenantId, 'bursar-1', concession.id, failingAudit),
    ).rejects.toThrow('audit append failed');
    expect((await ctx.repo.findConcessionById(concession.id, ctx.tenantId))?.status).toBe(
      'pending',
    );
  });

  it.skipIf(!live)('netting: audit failure creates no concession and no credit', async () => {
    const ctx = await setup();
    const disbursementId = randomUUID();
    await expect(
      ctx.service.applyScholarshipNetting(
        ctx.tenantId,
        'scholarship-netting',
        { studentId: ctx.studentId, disbursementId, amountCents: 3_000 },
        failingAudit,
      ),
    ).rejects.toThrow('audit append failed');
    expect(
      await ctx.repo.findConcessionBySourceDisbursementId(ctx.tenantId, disbursementId),
    ).toBeNull();
    expect((await ctx.service.getInvoice(ctx.tenantId, ctx.invoice.id)).amountCents).toBe(10_000);
    const tb = await ctx.service.getTrialBalance(ctx.tenantId);
    expect(tb.debitCents).toBe(tb.creditCents);
  });
});
