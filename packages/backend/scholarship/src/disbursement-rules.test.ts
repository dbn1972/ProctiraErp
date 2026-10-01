/**
 * PRC-H085 — disbursement status state machine, paid evidence and award cap.
 */
import { BusinessRuleError, ConflictError, ValidationError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import type { PaymentStatus } from './scholarship-repository.js';
import { ScholarshipService } from './scholarship-service.js';

const TENANT = 'tenant-h085';
const PAID = { paidDate: '2024-04-01', transactionReference: 'TXN-1' };

async function setup(frequency: 'one_time' | 'semester' = 'one_time') {
  const repo = new InMemoryScholarshipRepository();
  const service = new ScholarshipService(repo);
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
    disbursementFrequency: frequency,
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
    status: 'submitted',
    academicRecords: [],
    financialInfo: {},
    documents: [],
    personalStatement: null,
    areaId: null,
    gender: null,
    workflowInstanceId: null,
    submittedAt: new Date(),
    reviewedAt: null,
    reviewerId: null,
    reviewNotes: null,
  });
  await service.approveApplication(TENANT, 'app-1');
  return { repo, service };
}

/** Drive a fresh disbursement into `status` via allowed transitions. */
async function disbursementIn(status: PaymentStatus) {
  const { repo, service } = await setup();
  const d = await service.createDisbursement(TENANT, {
    applicationId: 'app-1',
    amount: 100,
    scheduledDate: '2024-04-01',
  });
  const path: Record<PaymentStatus, PaymentStatus[]> = {
    scheduled: [],
    processing: ['processing'],
    failed: ['processing', 'failed'],
    paid: ['paid'],
    cancelled: ['cancelled'],
  };
  for (const s of path[status]) {
    await service.updateDisbursement(TENANT, d.id, { paymentStatus: s, ...PAID });
  }
  return { repo, service, id: d.id };
}

const ALL: PaymentStatus[] = ['scheduled', 'processing', 'paid', 'failed', 'cancelled'];
const ALLOWED = new Set([
  'scheduled>processing',
  'scheduled>paid',
  'scheduled>cancelled',
  'processing>paid',
  'processing>failed',
  'processing>cancelled',
  'failed>scheduled',
  'failed>cancelled',
  'paid>cancelled',
]);

describe('disbursement transitions (PRC-H085)', () => {
  const cases = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));
  it.each(cases)('%s -> %s', async (from, to) => {
    const { service, id } = await disbursementIn(from);
    const call = service.updateDisbursement(TENANT, id, { paymentStatus: to, ...PAID });
    if (ALLOWED.has(`${from}>${to}`)) {
      await expect(call).resolves.toMatchObject({ paymentStatus: to });
    } else {
      await expect(call).rejects.toBeInstanceOf(ConflictError);
    }
  });

  it('paid -> scheduled is a 409', async () => {
    const { service, id } = await disbursementIn('paid');
    const err = await service
      .updateDisbursement(TENANT, id, { paymentStatus: 'scheduled' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).statusCode).toBe(409);
  });

  it('requires paidDate and transactionReference to mark paid', async () => {
    const { service, id } = await disbursementIn('processing');
    await expect(
      service.updateDisbursement(TENANT, id, { paymentStatus: 'paid', paidDate: '2024-04-01' }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      service.updateDisbursement(TENANT, id, { paymentStatus: 'paid', transactionReference: 'X' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('disbursement award cap (PRC-H085)', () => {
  it('over-award create -> 422', async () => {
    const { service } = await setup('one_time');
    await service.createDisbursement(TENANT, {
      applicationId: 'app-1',
      amount: 400,
      scheduledDate: '2024-04-01',
    });
    const err = await service
      .createDisbursement(TENANT, {
        applicationId: 'app-1',
        amount: 101,
        scheduledDate: '2024-05-01',
      })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BusinessRuleError);
    expect((err as BusinessRuleError).statusCode).toBe(422);
  });

  it('cancelled disbursements free up the cap; frequency multiplies it', async () => {
    const { service } = await setup('semester');
    const a = await service.createDisbursement(TENANT, {
      applicationId: 'app-1',
      amount: 500,
      scheduledDate: '2024-04-01',
    });
    await service.createDisbursement(TENANT, {
      applicationId: 'app-1',
      amount: 500,
      scheduledDate: '2024-10-01',
    });
    await expect(
      service.createDisbursement(TENANT, {
        applicationId: 'app-1',
        amount: 1,
        scheduledDate: '2024-11-01',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);
    await service.updateDisbursement(TENANT, a.id, { paymentStatus: 'cancelled' });
    await expect(
      service.createDisbursement(TENANT, {
        applicationId: 'app-1',
        amount: 500,
        scheduledDate: '2024-11-01',
      }),
    ).resolves.toBeTruthy();
  });
});
