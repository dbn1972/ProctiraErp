/**
 * PRC-M372: leave decisions are atomic — concurrent approvals debit once and a
 * failed status write rolls back the balance debit.
 */
import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '@proctira/common';
import { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
import { StaffLeaveService } from './leave-service.js';
import { PgStaffLeaveRepository } from './pg-leave-repository.js';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LEAVE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

describe('atomic leave decision (PRC-M372)', () => {
  it('two concurrent approvals deduct once; the other gets 409', async () => {
    const repo = new InMemoryStaffLeaveRepository();
    await repo.setBalance(TENANT, STAFF, 'annual', 10);
    const service = new StaffLeaveService(repo);
    const leave = await service.createLeave(TENANT, {
      staffId: STAFF,
      leaveType: 'annual',
      startDate: '2026-09-10',
      endDate: '2026-09-12',
    });
    const results = await Promise.allSettled([
      service.decideLeave(TENANT, leave.id, { status: 'approved' }, 'hr-1'),
      service.decideLeave(TENANT, leave.id, { status: 'approved' }, 'hr-2'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    expect((await repo.getBalance(TENANT, STAFF, 'annual'))?.balanceDays).toBe(7);
  });

  it('PG: status update failure rolls back the debit (same transaction)', async () => {
    const sql: string[] = [];
    const client = {
      query: async (text: string) => {
        sql.push(text.trim().split(/\s+/).slice(0, 3).join(' '));
        if (text.includes('FROM staff_leave_requests') && text.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: LEAVE,
                tenant_id: TENANT,
                staff_id: STAFF,
                leave_type: 'annual',
                start_date: '2026-09-10',
                end_date: '2026-09-12',
                reason: null,
                status: 'pending',
                decided_by: null,
                decided_at: null,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }
        if (text.includes('FROM staff_leave_balances')) return { rows: [{ balance_days: 10 }] };
        if (text.startsWith('UPDATE staff_leave_requests')) throw new Error('injected');
        return { rows: [] };
      },
      release: () => undefined,
    };
    const repo = new PgStaffLeaveRepository({ connect: async () => client } as never);
    vi.spyOn(repo, 'ensureSchema').mockResolvedValue();
    await expect(
      repo.decideLeaveAtomically(TENANT, LEAVE, {
        status: 'approved',
        decidedBy: 'hr-1',
        decidedAt: new Date(),
        debitDays: 3,
      }),
    ).rejects.toThrow('injected');
    const debit = sql.findIndex((s) => s.startsWith('UPDATE staff_leave_balances'));
    expect(debit).toBeGreaterThan(-1);
    expect(sql.slice(debit)).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
  });

  it('PG: zero rows from the pending-guarded update -> conflict', async () => {
    const client = {
      query: async (text: string) => {
        if (text.includes('FROM staff_leave_requests') && text.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: LEAVE,
                tenant_id: TENANT,
                staff_id: STAFF,
                leave_type: 'unpaid',
                start_date: '2026-09-10',
                end_date: '2026-09-12',
                status: 'pending',
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          };
        }
        return { rows: [] };
      },
      release: () => undefined,
    };
    const repo = new PgStaffLeaveRepository({ connect: async () => client } as never);
    vi.spyOn(repo, 'ensureSchema').mockResolvedValue();
    const service = new StaffLeaveService(repo);
    vi.spyOn(repo, 'findLeaveById').mockResolvedValue({
      id: LEAVE,
      tenantId: TENANT,
      staffId: STAFF,
      leaveType: 'unpaid',
      startDate: '2026-09-10',
      endDate: '2026-09-12',
      reason: null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await expect(
      service.decideLeave(TENANT, LEAVE, { status: 'approved' }, 'hr-1'),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
