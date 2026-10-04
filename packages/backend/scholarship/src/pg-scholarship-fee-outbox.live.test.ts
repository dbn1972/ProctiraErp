/**
 * PRC-H084 live Postgres proof for the disbursement->fees outbox against
 * db/sql/109_scholarship_fee_outbox.sql with the production adapters
 * (PgScholarshipRepository + PgScholarshipFeeOutbox):
 *  - the table is detected (no legacy fallback);
 *  - a failing fees hook leaves `paid` committed with one pending outbox row;
 *    the retry drain nets exactly once and marks the row done;
 *  - an enqueue failure inside the status transaction rolls the status back;
 *  - RLS: another tenant cannot see the row.
 * Skips without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { describe, expect, it } from 'vitest';
import { isPgScholarshipEnabled } from './create-scholarship-repository.js';
import { getSharedScholarshipPool, PgScholarshipRepository } from './pg-scholarship-repository.js';
import { PgScholarshipFeeOutbox, type ScholarshipFeeOutbox } from './scholarship-fee-outbox.js';
import { ScholarshipService } from './scholarship-service.js';

const live = isPgScholarshipEnabled();
const PAID = { paidDate: '2026-04-01', transactionReference: 'TXN-H084' };
const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 3600_000);

async function setup(outbox?: ScholarshipFeeOutbox) {
  const pool = getSharedScholarshipPool()!;
  const repo = new PgScholarshipRepository(pool);
  const feeOutbox = outbox ?? new PgScholarshipFeeOutbox(pool);
  const tenantId = randomUUID();
  const programId = randomUUID();
  const applicationId = randomUUID();
  await ensurePgTestTenant(pool, tenantId);
  await repo.createProgram({
    id: programId,
    tenantId,
    name: 'H084 Merit',
    description: null,
    applicationStartDate: '2026-01-01',
    applicationEndDate: '2026-12-31',
    totalSlots: 5,
    usedSlots: 0,
    amountPerRecipient: 500,
    amountPerRecipientCents: 50_000,
    currency: 'INR',
    disbursementFrequency: 'one_time',
    eligibility: {},
    status: 'open',
    academicPeriodId: null,
    fundingSourceId: null,
  });
  await repo.createApplication({
    id: applicationId,
    tenantId,
    programId,
    applicantId: randomUUID(),
    institutionId: randomUUID(),
    status: 'approved',
    academicRecords: [],
    financialInfo: {},
    documents: [],
    personalStatement: null,
    areaId: null,
    gender: null,
    workflowInstanceId: null,
    submittedAt: new Date(),
    reviewedAt: new Date(),
    reviewerId: null,
    reviewNotes: null,
  });
  const fees = { fail: 0, calls: 0, netted: new Map<string, number>() };
  const service = new ScholarshipService(repo, undefined, {
    onDisbursementPaid: async (input: { disbursementId: string; amountCents: number }) => {
      fees.calls++;
      if (fees.fail > 0) {
        fees.fail--;
        throw new Error('fees service unavailable');
      }
      if (!fees.netted.has(input.disbursementId)) {
        fees.netted.set(input.disbursementId, input.amountCents);
      }
    },
    onDisbursementReversed: async (input: { disbursementId: string }) => {
      fees.netted.delete(input.disbursementId);
    },
    feeOutbox,
    feeOutboxMaxAttempts: 3,
  });
  const d = await service.createDisbursement(tenantId, {
    applicationId,
    amount: 500,
    scheduledDate: '2026-04-01',
  });
  await service.updateDisbursement(tenantId, d.id, { paymentStatus: 'processing' });
  return { pool, repo, service, fees, tenantId, id: d.id };
}

describe.skipIf(!live)('scholarship fee outbox (live Postgres, PRC-H084)', () => {
  it('hook failure keeps paid + pending row; retry drain nets once', async () => {
    const { repo, service, fees, tenantId, id } = await setup();
    const outbox = new PgScholarshipFeeOutbox(getSharedScholarshipPool()!);
    expect(await outbox.isAvailable()).toBe(true);
    fees.fail = 1;
    await service.updateDisbursement(tenantId, id, { paymentStatus: 'paid', ...PAID });
    expect((await repo.findDisbursementById(id, tenantId))!.paymentStatus).toBe('paid');
    const open = await service.listOpenFeeOutbox(tenantId);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ disbursementId: id, status: 'pending', attempts: 1 });
    expect(await service.drainFeeOutbox(tenantId, { now: FAR_FUTURE })).toMatchObject({
      processed: 1,
      done: 1,
    });
    expect([...fees.netted.entries()]).toEqual([[id, 50_000]]);
    expect((await service.drainFeeOutbox(tenantId, { now: FAR_FUTURE })).processed).toBe(0);
    expect(await service.listOpenFeeOutbox(tenantId)).toEqual([]);
  });

  it('enqueue failure inside the status transaction rolls the status back', async () => {
    const pool = getSharedScholarshipPool()!;
    const real = new PgScholarshipFeeOutbox(pool);
    const failing: ScholarshipFeeOutbox = {
      isAvailable: () => real.isAvailable(),
      enqueue: async (tx, row) => {
        // Run a real statement on the caller's transaction, then fail.
        await real.enqueue(tx, row);
        throw new Error('outbox write failed');
      },
      listDue: (t, n, l) => real.listDue(t, n, l),
      listOpen: (t, l) => real.listOpen(t, l),
      findById: (t, i) => real.findById(t, i),
      markDone: (t, i) => real.markDone(t, i),
      markAttemptFailed: (t, i, e, n, s) => real.markAttemptFailed(t, i, e, n, s),
      requeue: (t, i, n) => real.requeue(t, i, n),
    };
    const { repo, service, fees, tenantId, id } = await setup(failing);
    await expect(
      service.updateDisbursement(tenantId, id, { paymentStatus: 'paid', ...PAID }),
    ).rejects.toThrow();
    expect((await repo.findDisbursementById(id, tenantId))!.paymentStatus).toBe('processing');
    // The row inserted before the failure was rolled back with the status.
    expect(await real.listOpen(tenantId, 10)).toEqual([]);
    expect(fees.calls).toBe(0);
  });

  it('RLS hides outbox rows from another tenant', async () => {
    const { pool, service, fees, tenantId, id } = await setup();
    fees.fail = 1;
    await service.updateDisbursement(tenantId, id, { paymentStatus: 'paid', ...PAID });
    const otherTenant = randomUUID();
    await ensurePgTestTenant(pool, otherTenant);
    const visible = await withPgTenant(pool, otherTenant, (client) =>
      client.query('SELECT id FROM scholarship_fee_outbox WHERE disbursement_id = $1', [id]),
    );
    expect(visible.rows).toEqual([]);
  });
});
