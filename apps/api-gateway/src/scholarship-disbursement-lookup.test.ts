/**
 * PRC-H020 — gateway bridge from fees netting to the scholarship repository.
 */
import { describe, expect, it } from 'vitest';
import {
  InMemoryScholarshipRepository,
  type ScholarshipApplicationEntity,
  type ScholarshipProgramEntity,
} from '@proctira/backend-scholarship';
import { createScholarshipDisbursementLookup } from './scholarship-disbursement-lookup.js';

const TENANT_A = '00000000-0000-4000-8000-00000000000a';
const TENANT_B = '00000000-0000-4000-8000-00000000000b';
const STUDENT = '00000000-0000-4000-8000-000000000099';

async function seed() {
  const repo = new InMemoryScholarshipRepository();
  const program = await repo.createProgram({
    id: 'prog-1',
    tenantId: TENANT_A,
    name: 'Merit',
    description: null,
    applicationStartDate: '2026-01-01',
    applicationEndDate: '2026-12-31',
    totalSlots: 10,
    usedSlots: 1,
    amountPerRecipient: 25,
    amountPerRecipientCents: 2500,
    currency: 'INR',
    disbursementFrequency: 'one_time',
    eligibility: {} as ScholarshipProgramEntity['eligibility'],
    status: 'active',
    academicPeriodId: null,
    fundingSourceId: null,
  } as Omit<ScholarshipProgramEntity, 'createdAt' | 'updatedAt'>);
  await repo.createApplication({
    id: 'app-1',
    tenantId: TENANT_A,
    programId: program.id,
    applicantId: STUDENT,
    institutionId: TENANT_A,
    status: 'approved',
    academicRecords: [],
    financialInfo: {} as ScholarshipApplicationEntity['financialInfo'],
    documents: [],
    personalStatement: null,
    areaId: null,
    gender: null,
    workflowInstanceId: null,
    submittedAt: new Date(),
    reviewedAt: null,
    reviewerId: null,
    reviewNotes: null,
  } as Omit<ScholarshipApplicationEntity, 'createdAt' | 'updatedAt'>);
  for (const [id, paymentStatus] of [
    ['disb-paid', 'paid'],
    ['disb-scheduled', 'scheduled'],
  ] as const) {
    await repo.createDisbursement({
      id,
      tenantId: TENANT_A,
      applicationId: 'app-1',
      amount: 25,
      amountCents: 2500,
      scheduledDate: '2026-02-01',
      paidDate: paymentStatus === 'paid' ? '2026-02-02' : null,
      paymentStatus,
      paymentMethod: null,
      transactionReference: null,
      notes: null,
    });
  }
  return repo;
}

describe('createScholarshipDisbursementLookup (PRC-H020)', () => {
  it('resolves the student and amount from the scholarship domain', async () => {
    const repo = await seed();
    const lookup = createScholarshipDisbursementLookup(() => repo);
    const row = await lookup.findDisbursement(TENANT_A, 'disb-paid');
    expect(row).toMatchObject({
      id: 'disb-paid',
      tenantId: TENANT_A,
      studentId: STUDENT,
      amountCents: 2500,
      paymentStatus: 'paid',
      currency: 'INR',
    });
  });

  it('does not resolve a disbursement from another tenant', async () => {
    const repo = await seed();
    const lookup = createScholarshipDisbursementLookup(() => repo);
    expect(await lookup.findDisbursement(TENANT_B, 'disb-paid')).toBeNull();
    expect(await lookup.findDisbursement(TENANT_A, 'unknown')).toBeNull();
  });

  it('lists only paid disbursements for the tenant', async () => {
    const repo = await seed();
    const lookup = createScholarshipDisbursementLookup(() => repo);
    const rows = await lookup.listPaidDisbursements(TENANT_A, {});
    expect(rows.map((r) => r.id)).toEqual(['disb-paid']);
    expect(await lookup.listPaidDisbursements(TENANT_B, {})).toEqual([]);
  });
  it('treats a non-UUID id rejected by Postgres (22P02) as not found', async () => {
    const repo = await seed();
    const pgError = Object.assign(new Error('invalid input syntax for type uuid: "e2e-disb"'), {
      code: '22P02',
    });
    repo.findDisbursementById = async () => {
      throw pgError;
    };
    const lookup = createScholarshipDisbursementLookup(() => repo);
    expect(await lookup.findDisbursement(TENANT_A, 'e2e-disb')).toBeNull();
    const wrapped = new Error('repository failed', { cause: pgError });
    repo.findDisbursementById = async () => {
      throw wrapped;
    };
    expect(await lookup.findDisbursement(TENANT_A, 'e2e-disb')).toBeNull();
  });
  it('rethrows other repository errors', async () => {
    const repo = await seed();
    repo.findDisbursementById = async () => {
      throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
    };
    const lookup = createScholarshipDisbursementLookup(() => repo);
    await expect(lookup.findDisbursement(TENANT_A, 'disb-paid')).rejects.toThrow('connection reset');
  });
});
