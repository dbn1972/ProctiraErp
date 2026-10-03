/**
 * Live Postgres proof for PRC-H083: approveApplicationAtomic under real concurrency.
 * - 2 concurrent approvals of one application → exactly one approved, one 409, one
 *   on-approval disbursement.
 * - Slot cap holds when different applications race for the last slot.
 * - A failure mid-transaction (after the slot claim) rolls the slot and status back.
 * - Migration 151: a second on-approval instalment row is refused by the unique index.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { randomUUID } from 'node:crypto';

import { BusinessRuleError, ConflictError } from '@proctira/common';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { describe, expect, it } from 'vitest';

import { getSharedScholarshipPool, PgScholarshipRepository } from './pg-scholarship-repository.js';
import { ScholarshipService } from './scholarship-service.js';

const DATABASE_URL = process.env['DATABASE_URL']?.trim();
const pool = DATABASE_URL ? getSharedScholarshipPool() : null;
const live = pool !== null;

async function seed(totalSlots: number, apps: number) {
  const tenantId = randomUUID();
  await ensurePgTestTenant(pool!, tenantId);
  const repo = new PgScholarshipRepository(pool!);
  const programId = randomUUID();
  await repo.createProgram({
    id: programId,
    tenantId,
    name: `Merit ${programId.slice(0, 6)}`,
    description: null,
    applicationStartDate: '2024-01-01',
    applicationEndDate: '2030-12-31',
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
  } as never);
  const ids: string[] = [];
  for (let i = 0; i < apps; i++) {
    const id = randomUUID();
    ids.push(id);
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
    } as never);
  }
  return { tenantId, programId, ids, repo, service: new ScholarshipService(repo) };
}

async function countDisbursements(tenantId: string, applicationId: string): Promise<number> {
  return withPgTenant(pool!, tenantId, async (client) => {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM scholarship_disbursements WHERE application_id = $1`,
      [applicationId],
    );
    return (r.rows[0] as { n: number }).n;
  });
}

async function usedSlots(tenantId: string, programId: string): Promise<number> {
  return withPgTenant(pool!, tenantId, async (client) => {
    const r = await client.query(`SELECT used_slots FROM scholarship_programs WHERE id = $1`, [
      programId,
    ]);
    return Number((r.rows[0] as { used_slots: number }).used_slots);
  });
}

describe('approveApplicationAtomic (live, PRC-H083)', () => {
  it.skipIf(!live)('2 concurrent approvals → 1 approved + 1 ConflictError', async () => {
    const { tenantId, programId, ids, service } = await seed(5, 1);
    const results = await Promise.allSettled([
      service.approveApplication(tenantId, ids[0]!, { scheduleFirstDisbursement: true }),
      service.approveApplication(tenantId, ids[0]!, { scheduleFirstDisbursement: true }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    expect(await countDisbursements(tenantId, ids[0]!)).toBe(1);
    expect(await usedSlots(tenantId, programId)).toBe(1);
  });

  it.skipIf(!live)('slot cap holds when 4 applications race for 2 slots', async () => {
    const { tenantId, programId, ids, service } = await seed(2, 4);
    const results = await Promise.allSettled(
      ids.map((id) => service.approveApplication(tenantId, id, {})),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(BusinessRuleError);
    }
    expect(await usedSlots(tenantId, programId)).toBe(2);
  });

  it.skipIf(!live)('failure after the slot claim rolls back slot and status', async () => {
    const { tenantId, programId, ids, repo } = await seed(3, 1);
    await expect(
      repo.approveApplicationAtomic(ids[0]!, tenantId, {
        reviewedAt: new Date(),
        reviewerId: null,
        reviewNotes: null,
        // Invalid date → the instalment insert fails inside the transaction.
        firstDisbursement: { id: randomUUID(), scheduledDate: 'not-a-date', notes: null },
      } as never),
    ).rejects.toThrow();
    expect(await usedSlots(tenantId, programId)).toBe(0);
    const app = await repo.findApplicationById(ids[0]!, tenantId);
    expect(app?.status).toBe('submitted');
  });

  it.skipIf(!live)('a second on-approval instalment row is refused (migration 151)', async () => {
    const { tenantId, ids, service } = await seed(3, 1);
    await service.approveApplication(tenantId, ids[0]!, { scheduleFirstDisbursement: true });
    await expect(
      withPgTenant(pool!, tenantId, (client) =>
        client.query(
          `INSERT INTO scholarship_disbursements (id, tenant_id, application_id, amount,
             amount_cents, scheduled_date, payment_status, disbursement_kind)
           VALUES ($1, $2, $3, 500, 50000, CURRENT_DATE, 'scheduled', 'on_approval')`,
          [randomUUID(), tenantId, ids[0]],
        ),
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
