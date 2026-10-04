/**
 * Live Postgres proof for the leave-balance race fix (G-718): concurrent
 * approvals against one balance serialize on `SELECT … FOR UPDATE`, so at most
 * `balance / days` of them succeed. Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { ensurePgTestStaff } from '@proctira/database/test-fixtures';
import { describe, expect, it } from 'vitest';

import { InsufficientLeaveBalanceError } from './leave-repository.js';
import { StaffLeaveService } from './leave-service.js';
import { getSharedStaffLeavePool, PgStaffLeaveRepository } from './pg-leave-repository.js';
const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-leave-repository.live.test' });

const pool = getSharedStaffLeavePool();
const live = Boolean(DATABASE_URL) && pool !== null;

describe('PgStaffLeaveRepository balance concurrency (live)', () => {
  it.skipIf(!live)('never over-consumes a balance under concurrent approvals', async () => {
    const repo = new PgStaffLeaveRepository(pool!);
    const service = new StaffLeaveService(repo);
    const tenantId = randomUUID();
    const staffId = randomUUID();
    await ensurePgTestStaff(pool!, tenantId, staffId);
    await repo.setBalance(tenantId, staffId, 'annual', 3);

    // Five 2-day requests against a 3-day balance: exactly one may be approved.
    const leaves = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        service.createLeave(tenantId, {
          staffId,
          leaveType: 'annual',
          startDate: `2026-10-0${i + 1}`,
          endDate: `2026-10-0${i + 2}`,
        }),
      ),
    );

    const outcomes = await Promise.allSettled(
      leaves.map((l) => service.decideLeave(tenantId, l.id, { status: 'approved' }, 'hr-1')),
    );
    const approved = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(approved).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      expect((r as PromiseRejectedResult).reason).toHaveProperty(
        'message',
        expect.stringMatching(/Insufficient annual leave balance/),
      );
    }

    const balance = await repo.getBalance(tenantId, staffId, 'annual');
    expect(balance?.balanceDays).toBe(1);

    await expect(repo.adjustBalance(tenantId, staffId, 'annual', -2)).rejects.toBeInstanceOf(
      InsufficientLeaveBalanceError,
    );
  });

  it.skipIf(!live)(
    'PRC-H091 end to end: bulk opening-balance import then approve annual leave',
    async () => {
      const repo = new PgStaffLeaveRepository(pool!);
      const service = new StaffLeaveService(repo);
      const tenantId = randomUUID();
      const staffA = randomUUID();
      const staffB = randomUUID();
      await ensurePgTestStaff(pool!, tenantId, staffA);
      await ensurePgTestStaff(pool!, tenantId, staffB);
      const exists = async (_t: string, id: string) => id === staffA || id === staffB;
      // A failing row (unknown staff) writes nothing.
      await expect(
        service.importOpeningBalances(
          tenantId,
          [
            { staffId: staffA, leaveType: 'annual', balanceDays: 10 },
            { staffId: randomUUID(), leaveType: 'annual', balanceDays: 10 },
          ],
          exists,
        ),
      ).rejects.toThrow(/no balances were written/);
      expect(await repo.getBalance(tenantId, staffA, 'annual')).toBeNull();

      const imported = await service.importOpeningBalances(
        tenantId,
        [
          { staffId: staffA, leaveType: 'annual', balanceDays: 10 },
          { staffId: staffB, leaveType: 'sick', balanceDays: 4.5 },
        ],
        exists,
      );
      expect(imported.imported).toBe(2);
      const leave = await service.createLeave(tenantId, {
        staffId: staffA,
        leaveType: 'annual',
        startDate: '2026-11-02',
        endDate: '2026-11-04',
      });
      const approved = await service.decideLeave(
        tenantId,
        leave.id,
        { status: 'approved' },
        'hr-1',
      );
      expect(approved.status).toBe('approved');
      expect((await repo.getBalance(tenantId, staffA, 'annual'))?.balanceDays).toBe(7);
      expect((await repo.getBalance(tenantId, staffB, 'sick'))?.balanceDays).toBe(4.5);
      // Tenant isolation: another tenant sees none of these balances.
      expect(await repo.getBalance(randomUUID(), staffA, 'annual')).toBeNull();
    },
  );
});
