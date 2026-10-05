/**
 * PRC-L153 / PRC-L246 live proof: Prisma staff rows and pg staff_contracts rows commit in the
 * SAME Postgres transaction during CSV import, so a contract failure leaves no staff row and
 * `allOrNothing` rolls back the whole file. Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { closeSharedPgPools, createPrismaClient, getSharedPgPool } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { afterAll, describe, expect, it } from 'vitest';
import { StaffHrService } from './hr-service.js';
import type { StaffContractRecord } from './hr-store.js';
import { PgStaffHrStore } from './pg-hr-ops-store.js';
import { PrismaStaffRepository } from './prisma-staff-repository.js';
import { StaffService } from './staff-service.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'staff-import-transaction.live.test' });
const pool = DATABASE_URL ? getSharedPgPool() : null;
const live = Boolean(DATABASE_URL) && pool !== null;

const HEADER =
  'firstName,lastName,dateOfBirth,identityNumber,contactPhone,position,contactEmail,contractType,startDate,endDate,salaryBand';
const row = (tag: string, n: number) =>
  `First${n},Last${n},1980-01-01,${tag}-${n},+1555000${n},Teacher,,permanent,2026-04-01,,L5`;

/** Contract store that fails AFTER its insert ran on the shared transaction. */
class FailingAfterInsertStore extends PgStaffHrStore {
  failOnCall = 0;
  private calls = 0;
  override async createContractOn(
    executor: { query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }> },
    record: StaffContractRecord,
  ): Promise<StaffContractRecord> {
    const out = await super.createContractOn(executor, record);
    this.calls += 1;
    if (this.calls === this.failOnCall) throw new Error('contract post-insert failure');
    return out;
  }
}

describe.skipIf(!live)('staff import staff+contract single transaction (live)', () => {
  const prisma = DATABASE_URL ? createPrismaClient({ datasourceUrl: DATABASE_URL }) : null;
  afterAll(async () => {
    await prisma?.$disconnect();
    await closeSharedPgPools();
  });

  async function setup(failOnCall: number) {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const store = new FailingAfterInsertStore(pool!);
    store.failOnCall = failOnCall;
    const staffService = new StaffService(new PrismaStaffRepository(prisma!));
    const hr = new StaffHrService(store, staffService);
    return { tenantId, store, staffService, hr };
  }

  it('per-row: a failing contract rolls back its staff row; other rows commit with contracts', async () => {
    const tag = `TX${randomUUID().slice(0, 6)}`;
    const { tenantId, staffService, hr } = await setup(2);
    const res = await hr.commitImport(tenantId, {
      csv: [HEADER, row(tag, 1), row(tag, 2), row(tag, 3)].join('\n'),
    });
    expect(res.created).toBe(2);
    expect(res.errors).toEqual([expect.objectContaining({ row: 3 })]);
    const staff = await staffService.listAll(tenantId);
    expect(staff.map((s) => s.identityNumber).sort()).toEqual([`${tag}-1`, `${tag}-3`]);
    const contracts = await hr.listContracts(tenantId);
    expect(new Set(contracts.map((c) => c.staffId))).toEqual(new Set(staff.map((s) => s.id)));
  });

  it('allOrNothing: a runtime failure on the last row leaves zero staff and zero contracts', async () => {
    const tag = `AN${randomUUID().slice(0, 6)}`;
    const { tenantId, staffService, hr } = await setup(3);
    await expect(
      hr.commitImport(tenantId, {
        csv: [HEADER, row(tag, 1), row(tag, 2), row(tag, 3)].join('\n'),
        allOrNothing: true,
      }),
    ).rejects.toThrow(/nothing was created/);
    expect(await staffService.listAll(tenantId)).toHaveLength(0);
    expect(await hr.listContracts(tenantId)).toHaveLength(0);
  });
});
