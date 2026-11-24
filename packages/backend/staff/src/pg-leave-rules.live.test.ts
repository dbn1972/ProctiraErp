/**
 * PRC-M373 — live Postgres proof of the leave rules on the production
 * repository (PgStaffLeaveRepository + db/sql/311):
 *
 * - concurrent overlapping creates: the EXCLUDE constraint lets exactly one in
 *   and the rest map to 409 (a read-then-insert check alone would race);
 * - the staff member linked to the leave (staff.user_id) cannot decide it;
 * - cancelling an approved leave restores the debited days and records who
 *   cancelled, in one transaction.
 *
 * Needs DATABASE_URL (runtime role); skipped without it.
 */
import { randomUUID } from 'node:crypto';

import { ConflictError } from '@proctira/common';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestStaff } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { describe, expect, it } from 'vitest';

import { StaffLeaveService } from './leave-service.js';
import { getSharedStaffLeavePool, PgStaffLeaveRepository } from './pg-leave-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-leave-rules.live.test' });
const pool = getSharedStaffLeavePool();
const live = Boolean(DATABASE_URL) && pool !== null;

describe('PRC-M373 staff leave rules (live)', () => {
  it.skipIf(!live)(
    'concurrent overlapping creates: exactly one wins, the rest are 409',
    async () => {
      const repo = new PgStaffLeaveRepository(pool!);
      const service = new StaffLeaveService(repo);
      const tenantId = randomUUID();
      const staffId = randomUUID();
      await ensurePgTestStaff(pool!, tenantId, staffId);

      const outcomes = await Promise.allSettled(
        Array.from({ length: 4 }, (_, i) =>
          service.createLeave(tenantId, {
            staffId,
            leaveType: 'unpaid',
            startDate: '2026-11-10',
            endDate: `2026-11-1${i + 1}`,
          }),
        ),
      );
      const ok = outcomes.filter((o) => o.status === 'fulfilled');
      const failed = outcomes.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(3);
      for (const f of failed) expect(f.reason).toBeInstanceOf(ConflictError);

      // Another staff member in the same tenant is unaffected.
      const other = randomUUID();
      await ensurePgTestStaff(pool!, tenantId, other);
      await expect(
        service.createLeave(tenantId, {
          staffId: other,
          leaveType: 'unpaid',
          startDate: '2026-11-10',
          endDate: '2026-11-11',
        }),
      ).resolves.toMatchObject({ status: 'pending' });
    },
  );

  it.skipIf(!live)('the staff member linked to the leave cannot decide it', async () => {
    const repo = new PgStaffLeaveRepository(pool!);
    const service = new StaffLeaveService(repo);
    const tenantId = randomUUID();
    const staffId = randomUUID();
    const login = randomUUID();
    await ensurePgTestStaff(pool!, tenantId, staffId);
    await withPgTenant(pool!, tenantId, (client) =>
      client.query('UPDATE staff SET user_id = $3::uuid WHERE tenant_id = $1 AND id = $2', [
        tenantId,
        staffId,
        login,
      ]),
    );
    const leave = await service.createLeave(tenantId, {
      staffId,
      leaveType: 'unpaid',
      startDate: '2026-11-20',
      endDate: '2026-11-20',
    });
    await expect(
      service.decideLeave(tenantId, leave.id, { status: 'approved' }, login),
    ).rejects.toBeInstanceOf(ConflictError);
    expect((await repo.findLeaveById(leave.id, tenantId))?.status).toBe('pending');
    await expect(
      service.decideLeave(tenantId, leave.id, { status: 'approved' }, 'hr-1'),
    ).resolves.toMatchObject({ status: 'approved' });
  });

  it.skipIf(!live)('cancelling an approved leave restores the debited days', async () => {
    const repo = new PgStaffLeaveRepository(pool!);
    const service = new StaffLeaveService(repo);
    const tenantId = randomUUID();
    const staffId = randomUUID();
    await ensurePgTestStaff(pool!, tenantId, staffId);
    await repo.setBalance(tenantId, staffId, 'annual', 10);
    const leave = await service.createLeave(tenantId, {
      staffId,
      leaveType: 'annual',
      startDate: '2026-12-01',
      endDate: '2026-12-03',
    });
    await service.decideLeave(tenantId, leave.id, { status: 'approved' }, 'hr-1');
    expect((await repo.getBalance(tenantId, staffId, 'annual'))?.balanceDays).toBe(7);

    const cancelled = await service.cancelLeave(tenantId, leave.id, 'hr-2');
    expect(cancelled.status).toBe('cancelled');
    expect((await repo.getBalance(tenantId, staffId, 'annual'))?.balanceDays).toBe(10);
    const row = await withPgTenant(pool!, tenantId, (client) =>
      client.query<{ cancelled_by: string; cancelled_at: Date | null; decided_by: string }>(
        'SELECT cancelled_by, cancelled_at, decided_by FROM staff_leave_requests WHERE id = $1',
        [leave.id],
      ),
    );
    expect(row.rows[0]).toMatchObject({ cancelled_by: 'hr-2', decided_by: 'hr-1' });
    expect(row.rows[0]!.cancelled_at).not.toBeNull();

    await expect(service.cancelLeave(tenantId, leave.id, 'hr-2')).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await repo.getBalance(tenantId, staffId, 'annual'))?.balanceDays).toBe(10);
    // The cancelled leave no longer blocks its days.
    await expect(
      service.createLeave(tenantId, {
        staffId,
        leaveType: 'annual',
        startDate: '2026-12-02',
        endDate: '2026-12-02',
      }),
    ).resolves.toMatchObject({ status: 'pending' });
  });
});
