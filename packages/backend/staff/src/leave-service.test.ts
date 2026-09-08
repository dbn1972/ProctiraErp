import { describe, expect, it } from 'vitest';
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';

import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { inclusiveLeaveDays, StaffLeaveService } from './leave-service.js';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('inclusiveLeaveDays', () => {
  it('counts inclusive calendar days', () => {
    expect(inclusiveLeaveDays('2026-09-10', '2026-09-10')).toBe(1);
    expect(inclusiveLeaveDays('2026-09-10', '2026-09-12')).toBe(3);
  });
});

describe('StaffLeaveService', () => {
  it('creates, lists, and approves leave; isolates tenants', async () => {
    const repo = new InMemoryStaffLeaveRepository();
    await repo.setBalance(TENANT_A, STAFF_ID, 'sick', 10);
    const service = new StaffLeaveService(repo);
    const leave = await service.createLeave(TENANT_A, {
      staffId: STAFF_ID,
      leaveType: 'sick',
      startDate: '2026-09-10',
      endDate: '2026-09-12',
      reason: 'Fever',
    });
    expect(leave.status).toBe('pending');

    expect(await service.listLeaves(TENANT_B)).toHaveLength(0);
    expect((await service.listLeaves(TENANT_A)).map((row) => row.id)).toContain(leave.id);

    const approved = await service.decideLeave(
      TENANT_A,
      leave.id,
      { status: 'approved' },
      'principal-1',
    );
    expect(approved.status).toBe('approved');
    expect(approved.decidedBy).toBe('principal-1');
    expect((await repo.getBalance(TENANT_A, STAFF_ID, 'sick'))?.balanceDays).toBe(7);

    await expect(
      service.decideLeave(TENANT_A, leave.id, { status: 'rejected' }, 'principal-1'),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      service.decideLeave(TENANT_B, leave.id, { status: 'approved' }, 'other'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('approve/deny matrix: reject does not deduct balance', async () => {
    const repo = new InMemoryStaffLeaveRepository();
    await repo.setBalance(TENANT_A, STAFF_ID, 'annual', 5);
    const service = new StaffLeaveService(repo);
    const leave = await service.createLeave(TENANT_A, {
      staffId: STAFF_ID,
      leaveType: 'annual',
      startDate: '2026-10-01',
      endDate: '2026-10-02',
    });

    const rejected = await service.decideLeave(TENANT_A, leave.id, { status: 'rejected' }, 'hr-1');
    expect(rejected.status).toBe('rejected');
    expect((await repo.getBalance(TENANT_A, STAFF_ID, 'annual'))?.balanceDays).toBe(5);
  });

  it('rejects approve when balance is insufficient', async () => {
    const repo = new InMemoryStaffLeaveRepository();
    await repo.setBalance(TENANT_A, STAFF_ID, 'annual', 1);
    const service = new StaffLeaveService(repo);

    // Soft-check on create when balance row exists
    await expect(
      service.createLeave(TENANT_A, {
        staffId: STAFF_ID,
        leaveType: 'annual',
        startDate: '2026-11-01',
        endDate: '2026-11-05',
      }),
    ).rejects.toBeInstanceOf(BusinessRuleError);

    // Create without a balance row (soft-check skipped), then zero balance → approve fails
    const leave = await service.createLeave(TENANT_A, {
      staffId: STAFF_ID,
      leaveType: 'casual',
      startDate: '2026-11-01',
      endDate: '2026-11-01',
    });
    await repo.setBalance(TENANT_A, STAFF_ID, 'casual', 0);
    await expect(
      service.decideLeave(TENANT_A, leave.id, { status: 'approved' }, 'hr-1'),
    ).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('allows unpaid leave without balance deduction', async () => {
    const repo = new InMemoryStaffLeaveRepository();
    const service = new StaffLeaveService(repo);
    const leave = await service.createLeave(TENANT_A, {
      staffId: STAFF_ID,
      leaveType: 'unpaid',
      startDate: '2026-12-01',
      endDate: '2026-12-03',
    });
    const approved = await service.decideLeave(TENANT_A, leave.id, { status: 'approved' }, 'hr-1');
    expect(approved.status).toBe('approved');
    expect(await repo.getBalance(TENANT_A, STAFF_ID, 'unpaid')).toBeNull();
  });
});
