/**
 * PRC-H084 — transactional disbursement->fees outbox: status + outbox row commit
 * together; a failing hook leaves the row pending for the retry worker; replay of
 * a dead-lettered row nets exactly once; reversal path is delivered the same way;
 * an unavailable outbox degrades to the legacy compensation path.
 */
import { AppError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import {
  InMemoryScholarshipFeeOutbox,
  type ScholarshipFeeOutbox,
} from './scholarship-fee-outbox.js';
import { ScholarshipService } from './scholarship-service.js';

const TENANT = 'tenant-h084-outbox';
const PAID = { paidDate: '2024-04-01', transactionReference: 'TXN-1' };

/** Fake fees ledger, idempotent by disbursementId (like applyScholarshipNetting). */
function ledger() {
  const state = { failPaid: 0, failReversed: 0, paidCalls: 0, reversedCalls: 0 };
  const netted = new Map<string, number>();
  return {
    state,
    netted,
    paid: async (input: { disbursementId: string; amountCents: number }) => {
      state.paidCalls++;
      if (state.failPaid > 0) {
        state.failPaid--;
        throw new Error('fees service unavailable');
      }
      if (!netted.has(input.disbursementId)) netted.set(input.disbursementId, input.amountCents);
    },
    reversed: async (input: { disbursementId: string }) => {
      state.reversedCalls++;
      if (state.failReversed > 0) {
        state.failReversed--;
        throw new Error('fees service unavailable');
      }
      netted.delete(input.disbursementId);
    },
  };
}

async function setup(outbox: ScholarshipFeeOutbox, maxAttempts = 3) {
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
  const fees = ledger();
  const service = new ScholarshipService(repo, undefined, {
    onDisbursementPaid: fees.paid,
    onDisbursementReversed: fees.reversed,
    feeOutbox: outbox,
    feeOutboxMaxAttempts: maxAttempts,
  });
  const d = await service.createDisbursement(TENANT, {
    applicationId: 'app-1',
    amount: 500,
    scheduledDate: '2024-04-01',
  });
  await service.updateDisbursement(TENANT, d.id, { paymentStatus: 'processing' });
  return { repo, service, fees, id: d.id };
}

const FAR_FUTURE = new Date(Date.now() + 365 * 24 * 3600_000);

describe('disbursement fee outbox (PRC-H084)', () => {
  it('happy path: status + outbox row commit, delivered immediately, row done', async () => {
    const outbox = new InMemoryScholarshipFeeOutbox();
    const { service, fees, id } = await setup(outbox);
    await service.updateDisbursement(TENANT, id, { paymentStatus: 'paid', ...PAID });
    expect([...fees.netted.entries()]).toEqual([[id, 50_000]]);
    expect(await service.listOpenFeeOutbox(TENANT)).toEqual([]);
  });

  it('hook throws -> paid status persists, outbox row pending; worker retry nets once', async () => {
    const outbox = new InMemoryScholarshipFeeOutbox();
    const { repo, service, fees, id } = await setup(outbox);
    fees.state.failPaid = 1;
    const updated = await service.updateDisbursement(TENANT, id, {
      paymentStatus: 'paid',
      ...PAID,
    });
    expect(updated.paymentStatus).toBe('paid');
    expect((await repo.findDisbursementById(id, TENANT))!.paymentStatus).toBe('paid');
    expect(fees.netted.size).toBe(0);
    const open = await service.listOpenFeeOutbox(TENANT);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      disbursementId: id,
      event: 'disbursement.paid',
      status: 'pending',
      attempts: 1,
    });
    expect(open[0]!.lastError).toContain('fees service unavailable');

    // Not due yet (backoff) -> nothing processed at "now".
    expect((await service.drainFeeOutbox(TENANT, { now: new Date(0) })).processed).toBe(0);
    const r = await service.drainFeeOutboxRetries(FAR_FUTURE);
    expect(r).toMatchObject({ processed: 1, done: 1 });
    expect([...fees.netted.entries()]).toEqual([[id, 50_000]]);
    // Second drain is a no-op: nets once.
    expect((await service.drainFeeOutbox(TENANT, { now: FAR_FUTURE })).processed).toBe(0);
    expect(fees.state.paidCalls).toBe(2);
  });

  it('dead-letters after max attempts; replay redelivers and nets exactly once', async () => {
    const outbox = new InMemoryScholarshipFeeOutbox();
    const { service, fees, id } = await setup(outbox, 2);
    fees.state.failPaid = 2;
    await service.updateDisbursement(TENANT, id, { paymentStatus: 'paid', ...PAID });
    expect((await service.drainFeeOutbox(TENANT, { now: FAR_FUTURE })).failed).toBe(1);
    const [dead] = await service.listOpenFeeOutbox(TENANT);
    expect(dead!.status).toBe('failed');
    // Dead-lettered rows are not picked by the worker.
    expect((await service.drainFeeOutbox(TENANT, { now: FAR_FUTURE })).processed).toBe(0);

    const replay = await service.replayFeeOutbox(TENANT, { id: dead!.id, now: FAR_FUTURE });
    expect(replay).toMatchObject({ processed: 1, done: 1 });
    // Replaying again (row already done) does not net twice.
    await service.replayFeeOutbox(TENANT, { now: FAR_FUTURE });
    expect([...fees.netted.entries()]).toEqual([[id, 50_000]]);
    expect(await service.listOpenFeeOutbox(TENANT)).toEqual([]);
  });

  it('replay of an unknown id is a 404', async () => {
    const { service } = await setup(new InMemoryScholarshipFeeOutbox());
    await expect(
      service.replayFeeOutbox(TENANT, { id: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('reversal path: cancelled status persists, reversal delivered via outbox once', async () => {
    const outbox = new InMemoryScholarshipFeeOutbox();
    const { repo, service, fees, id } = await setup(outbox);
    await service.updateDisbursement(TENANT, id, { paymentStatus: 'paid', ...PAID });
    fees.state.failReversed = 1;
    const cancelled = await service.updateDisbursement(TENANT, id, {
      paymentStatus: 'cancelled',
    });
    expect(cancelled.paymentStatus).toBe('cancelled');
    expect((await repo.findDisbursementById(id, TENANT))!.paymentStatus).toBe('cancelled');
    expect(fees.netted.has(id)).toBe(true);
    const [pending] = await service.listOpenFeeOutbox(TENANT);
    expect(pending).toMatchObject({ event: 'disbursement.reversed', status: 'pending' });
    await service.drainFeeOutbox(TENANT, { now: FAR_FUTURE });
    expect(fees.netted.has(id)).toBe(false);
    expect(fees.state.reversedCalls).toBe(2);
  });

  it('outbox enqueue failure rolls back the status write', async () => {
    const outbox = new InMemoryScholarshipFeeOutbox();
    const { repo, service, fees, id } = await setup(outbox);
    outbox.enqueue = async () => {
      throw new Error('outbox insert failed');
    };
    await expect(
      service.updateDisbursement(TENANT, id, { paymentStatus: 'paid', ...PAID }),
    ).rejects.toThrow('outbox insert failed');
    expect((await repo.findDisbursementById(id, TENANT))!.paymentStatus).toBe('processing');
    expect(fees.state.paidCalls).toBe(0);
  });

  it('outbox table absent -> degrades to legacy compensation (status restored, 503)', async () => {
    const outbox = new InMemoryScholarshipFeeOutbox();
    outbox.isAvailable = async () => false;
    const { repo, service, fees, id } = await setup(outbox);
    fees.state.failPaid = 1;
    const err = await service
      .updateDisbursement(TENANT, id, { paymentStatus: 'paid', ...PAID })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(503);
    expect((await repo.findDisbursementById(id, TENANT))!.paymentStatus).toBe('processing');
  });
});
