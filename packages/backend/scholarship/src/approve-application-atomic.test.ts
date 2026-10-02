/**
 * PRC-H083 — approveApplication must be atomic: concurrent approvals of the
 * same application yield one success + one ConflictError and exactly one
 * first instalment; concurrent approvals of different applications never
 * push usedSlots past totalSlots.
 */
import { ConflictError, BusinessRuleError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryScholarshipRepository } from './in-memory-repository.js';
import { ScholarshipService } from './scholarship-service.js';

const TENANT = 'tenant-h083';

async function seed(repo: InMemoryScholarshipRepository, totalSlots: number, apps: number) {
  await repo.createProgram({
    id: 'prog-1',
    tenantId: TENANT,
    name: 'Merit',
    description: null,
    applicationStartDate: '2024-01-01',
    applicationEndDate: '2024-12-31',
    totalSlots,
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
  const ids: string[] = [];
  for (let i = 0; i < apps; i++) {
    const id = `app-${i}`;
    ids.push(id);
    await repo.createApplication({
      id,
      tenantId: TENANT,
      programId: 'prog-1',
      applicantId: `student-${i}`,
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
  }
  return ids;
}

describe('approveApplication atomicity (PRC-H083)', () => {
  it('two concurrent approvals of one application: one wins, one 409, one disbursement', async () => {
    const repo = new InMemoryScholarshipRepository();
    const service = new ScholarshipService(repo);
    const [appId] = await seed(repo, 5, 1);

    const results = await Promise.allSettled([
      service.approveApplication(TENANT, appId!, { scheduleFirstDisbursement: true }),
      service.approveApplication(TENANT, appId!, { scheduleFirstDisbursement: true }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictError);
    expect((await repo.findProgramById('prog-1', TENANT))!.usedSlots).toBe(1);
    expect(await repo.listDisbursementsByApplication(appId!, TENANT)).toHaveLength(1);
  });

  it('N concurrent approvals with 1 slot left: exactly one succeeds', async () => {
    const repo = new InMemoryScholarshipRepository();
    const service = new ScholarshipService(repo);
    const ids = await seed(repo, 1, 6);

    const results = await Promise.allSettled(
      ids.map((id) => service.approveApplication(TENANT, id)),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(BusinessRuleError);
    }
    const program = (await repo.findProgramById('prog-1', TENANT))!;
    expect(program.usedSlots).toBe(1);
    expect(program.usedSlots).toBeLessThanOrEqual(program.totalSlots);
  });
});
