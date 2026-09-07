import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '@proctira/common';

import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { StaffLeaveService } from './leave-service.js';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STAFF_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('StaffLeaveService', () => {
  it('creates, lists, and approves leave; isolates tenants', async () => {
    const service = new StaffLeaveService(new InMemoryStaffLeaveRepository());
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

    await expect(
      service.decideLeave(TENANT_A, leave.id, { status: 'rejected' }, 'principal-1'),
    ).rejects.toBeInstanceOf(ConflictError);

    await expect(
      service.decideLeave(TENANT_B, leave.id, { status: 'approved' }, 'other'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
