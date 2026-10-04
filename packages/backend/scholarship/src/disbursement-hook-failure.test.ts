/**
 * PRC-H084 — if the fee netting/un-netting hook fails, the disbursement status
 * must stay at its previous value so a retry re-fires the hook and the fee
 * ledger is netted exactly once.
 */
import { AppError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { ScholarshipService } from './scholarship-service.js';

const TENANT = 'tenant-h084';
const PAID = { paidDate: '2024-04-01', transactionReference: 'TXN-1' };

/** Fake fees ledger: idempotent by disbursementId, fails the first N calls. */
function flakyLedger(failFirst: number) {
  let calls = 0;
  const netted = new Set<string>();
  const unnetted = new Set<string>();
  return {
    netted,
    unnetted,
    get calls() {
      return calls;
    },
    paid: async (input: { disbursementId: string }) => {
      calls++;
      if (calls <= failFirst) throw new Error('fees service unavailable');
      netted.add(input.disbursementId);
    },
    reversed: async (input: { disbursementId: string }) => {
      calls++;
      if (calls <= failFirst) throw new Error('fees service unavailable');
      unnetted.add(input.disbursementId);
    },
  };
}

async function setup(
  onPaid: (i: { disbursementId: string }) => Promise<void>,
  onReversed = onPaid,
) {
  const repo = new InMemoryScholarshipRepository();
  await repo.createProgram({
    id: 'prog-1',
    tenantId: TENANT,
    name: 'Merit',
    description: null,
    applicationStartDate: '2024-01-01',
    applicationEndDate: '2024-12-31',
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
    id: 'app-1',
    tenantId: TENANT,
    programId: 'prog-1',
    applicantId: 'student-1',
    institutionId: 'inst-1',
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
  const service = new ScholarshipService(repo, undefined, {
    onDisbursementPaid: onPaid,
    onDisbursementReversed: onReversed,
  });
  const d = await service.createDisbursement(TENANT, {
    applicationId: 'app-1',
    amount: 500,
    scheduledDate: '2024-04-01',
  });
  await service.updateDisbursement(TENANT, d.id, { paymentStatus: 'processing' });
  return { repo, service, id: d.id };
}

describe('disbursement fee-hook failure (PRC-H084)', () => {
  it('paid hook throws -> status stays processing; retry nets exactly once', async () => {
    const ledger = flakyLedger(1);
    const { repo, service, id } = await setup(ledger.paid);

    const err = await service
      .updateDisbursement(TENANT, id, { paymentStatus: 'paid', ...PAID })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBeGreaterThanOrEqual(500);
    const after = (await repo.findDisbursementById(id, TENANT))!;
    expect(after.paymentStatus).toBe('processing');
    expect(after.paidDate).toBeNull();
    expect(after.transactionReference).toBeNull();
    expect(ledger.netted.size).toBe(0);

    await service.updateDisbursement(TENANT, id, { paymentStatus: 'paid', ...PAID });
    expect((await repo.findDisbursementById(id, TENANT))!.paymentStatus).toBe('paid');
    expect([...ledger.netted]).toEqual([id]);
  });

  it('reversal hook throws -> status stays paid; retry un-nets exactly once', async () => {
    const paidLedger = flakyLedger(0);
    const reverseLedger = flakyLedger(1);
    const { repo, service, id } = await setup(paidLedger.paid, reverseLedger.reversed);
    await service.updateDisbursement(TENANT, id, { paymentStatus: 'paid', ...PAID });

    await expect(
      service.updateDisbursement(TENANT, id, { paymentStatus: 'cancelled' }),
    ).rejects.toBeInstanceOf(AppError);
    const after = (await repo.findDisbursementById(id, TENANT))!;
    expect(after.paymentStatus).toBe('paid');
    expect(after.transactionReference).toBe('TXN-1');
    expect(reverseLedger.unnetted.size).toBe(0);

    await service.updateDisbursement(TENANT, id, { paymentStatus: 'cancelled' });
    expect((await repo.findDisbursementById(id, TENANT))!.paymentStatus).toBe('cancelled');
    expect([...reverseLedger.unnetted]).toEqual([id]);
  });
});
