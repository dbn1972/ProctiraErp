/**
 * PRC-H083 live Postgres concurrency proof for approveApplicationAtomic:
 *  - two concurrent approvals of one application -> exactly one success, one 409;
 *  - concurrent approvals of distinct applications never oversubscribe the slot cap;
 *  - a failure mid-transaction (after the slot claim) rolls back slot + status + instalment.
 * Skips without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { AppError, ConflictError } from '@proctira/common';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { describe, expect, it } from 'vitest';
import { isPgScholarshipEnabled } from './create-scholarship-repository.js';
import { getSharedScholarshipPool, PgScholarshipRepository } from './pg-scholarship-repository.js';
import type { PgPoolLike } from './pg-scholarship-repository.js';
import { ScholarshipService } from './scholarship-service.js';

const live = isPgScholarshipEnabled();

async function seed(repo: PgScholarshipRepository, totalSlots: number, applications: number) {
  const pool = getSharedScholarshipPool()!;
  const tenantId = randomUUID();
  const programId = randomUUID();
  await ensurePgTestTenant(pool, tenantId);
  await repo.createProgram({
    id: programId,
    tenantId,
    name: 'H083 Merit',
    description: null,
    applicationStartDate: '2026-01-01',
    applicationEndDate: '2026-12-31',
    totalSlots,
    usedSlots: 0,
    amountPerRecipient: 1000,
    amountPerRecipientCents: 100_000,
    currency: 'INR',
    disbursementFrequency: 'one_time',
    eligibility: {},
    status: 'open',
    academicPeriodId: null,
    fundingSourceId: null,
  });
  const applicationIds: string[] = [];
  for (let i = 0; i < applications; i++) {
    const id = randomUUID();
    applicationIds.push(id);
    await repo.createApplication({
      id,
      tenantId,
      programId,
      applicantId: randomUUID(),
      institutionId: randomUUID(),
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
  return { tenantId, programId, applicationIds };
}

describe.skipIf(!live)('approveApplicationAtomic live concurrency (PRC-H083)', () => {
  it('two concurrent approvals of one application -> 1 success, 1 conflict (409)', async () => {
    const repo = new PgScholarshipRepository(getSharedScholarshipPool()!);
    const service = new ScholarshipService(repo);
    const { tenantId, programId, applicationIds } = await seed(repo, 5, 1);
    const id = applicationIds[0]!;
    const results = await Promise.allSettled([
      service.approveApplication(tenantId, id, { scheduleFirstDisbursement: true }),
      service.approveApplication(tenantId, id, { scheduleFirstDisbursement: true }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const reason = failed[0]!.reason as AppError;
    // The loser either sees the decided status up front (business rule) or loses the lock race (409).
    expect(reason).toBeInstanceOf(AppError);
    if (reason instanceof ConflictError) expect(reason.statusCode).toBe(409);
    expect((await repo.findProgramById(programId, tenantId))!.usedSlots).toBe(1);
    expect(await repo.listDisbursementsByApplication(id, tenantId)).toHaveLength(1);
  });

  it('concurrent approvals of distinct applications respect the slot cap', async () => {
    const repo = new PgScholarshipRepository(getSharedScholarshipPool()!);
    const service = new ScholarshipService(repo);
    const { tenantId, programId, applicationIds } = await seed(repo, 2, 6);
    const results = await Promise.allSettled(
      applicationIds.map((id) => service.approveApplication(tenantId, id)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect((await repo.findProgramById(programId, tenantId))!.usedSlots).toBe(2);
    let approved = 0;
    for (const id of applicationIds) {
      if ((await repo.findApplicationById(id, tenantId))!.status === 'approved') approved++;
    }
    expect(approved).toBe(2);
  });

  it('failure mid-transaction rolls back slot claim, status flip and instalment', async () => {
    const shared = getSharedScholarshipPool()!;
    // Pool whose clients fail on the instalment INSERT (after slot claim + status flip).
    const killing: PgPoolLike = {
      query: shared.query.bind(shared) as PgPoolLike['query'],
      end: async () => undefined,
      connect: (async () => {
        const client = await shared.connect();
        const query = client.query.bind(client) as (t: string, v?: unknown[]) => Promise<unknown>;
        return Object.assign(Object.create(client) as typeof client, {
          query: (text: string, values?: unknown[]) =>
            typeof text === 'string' && text.includes('INSERT INTO scholarship_disbursements')
              ? Promise.reject(new Error('connection killed mid-transaction'))
              : query(text, values),
          release: () => client.release(),
        });
      }) as unknown as PgPoolLike['connect'],
    };
    const repo = new PgScholarshipRepository(shared);
    const { tenantId, programId, applicationIds } = await seed(repo, 3, 1);
    const id = applicationIds[0]!;
    const killingService = new ScholarshipService(new PgScholarshipRepository(killing));
    await expect(
      killingService.approveApplication(tenantId, id, { scheduleFirstDisbursement: true }),
    ).rejects.toThrow('connection killed mid-transaction');
    expect((await repo.findProgramById(programId, tenantId))!.usedSlots).toBe(0);
    expect((await repo.findApplicationById(id, tenantId))!.status).toBe('submitted');
    expect(await repo.listDisbursementsByApplication(id, tenantId)).toHaveLength(0);
    // And a clean retry still succeeds once.
    await new ScholarshipService(repo).approveApplication(tenantId, id, {
      scheduleFirstDisbursement: true,
    });
    expect((await repo.findProgramById(programId, tenantId))!.usedSlots).toBe(1);
  });
});
