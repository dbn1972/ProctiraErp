/**
 * Live Postgres proof for the leave-balance race fix (G-718): concurrent
 * approvals against one balance serialize on `SELECT … FOR UPDATE`, so at most
 * `balance / days` of them succeed. Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { InsufficientLeaveBalanceError } from './leave-repository.js';
import { StaffLeaveService } from './leave-service.js';
import { getSharedStaffLeavePool, PgStaffLeaveRepository } from './pg-leave-repository.js';

const pool = getSharedStaffLeavePool();

describe('PgStaffLeaveRepository balance concurrency (live)', () => {
  it.skipIf(!pool)('never over-consumes a balance under concurrent approvals', async () => {
    const repo = new PgStaffLeaveRepository(pool!);
    const service = new StaffLeaveService(repo);
    const tenantId = randomUUID();
    const staffId = randomUUID();
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
});
