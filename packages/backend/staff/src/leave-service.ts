/**
 * Staff HR leave service — create, list, approve/reject with balances (G-206).
 */
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import {
  InsufficientLeaveBalanceError,
  LeaveBalanceMissingError,
  LeaveNotPendingError,
  type StaffLeaveEntity,
  type StaffLeaveRepository,
  type StaffLeaveStatus,
  type StaffLeaveType,
} from './leave-repository.js';
import {
  BALANCE_LEAVE_TYPES,
  type CreateStaffLeaveInput,
  type DecideStaffLeaveInput,
} from './leave-schemas.js';
import { assertStaffInTenant, type StaffExistsCheck } from './staff-reference.js';

/** Inclusive calendar-day count between ISO dates (YYYY-MM-DD). */
export function inclusiveLeaveDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00.000Z`);
  const end = Date.parse(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    throw new BusinessRuleError('Invalid leave date range');
  }
  return Math.floor((end - start) / 86_400_000) + 1;
}

function requiresBalance(leaveType: StaffLeaveType): boolean {
  return leaveType !== 'unpaid';
}

export class StaffLeaveService {
  constructor(
    private readonly repository: StaffLeaveRepository,
    /** PRC-M374: tenant-scoped staff existence check. */
    private readonly staffExists?: StaffExistsCheck,
  ) {}

  async getBalance(tenantId: string, staffId: string, leaveType: StaffLeaveType) {
    return this.repository.getBalance(tenantId, staffId, leaveType);
  }

  /** PRC-H091: all tracked balances for one staff member (missing rows omitted). */
  async listBalances(tenantId: string, staffId: string) {
    const rows = await Promise.all(
      BALANCE_LEAVE_TYPES.map((t) => this.repository.getBalance(tenantId, staffId, t)),
    );
    return rows.filter((r): r is NonNullable<typeof r> => r !== null);
  }
  async setBalance(
    tenantId: string,
    staffId: string,
    leaveType: StaffLeaveType,
    balanceDays: number,
  ) {
    return this.repository.setBalance(tenantId, staffId, leaveType, balanceDays);
  }

  async createLeave(tenantId: string, input: CreateStaffLeaveInput) {
    await assertStaffInTenant(this.staffExists, tenantId, input.staffId);
    if (input.endDate < input.startDate) {
      throw new BusinessRuleError('End date must be on or after start date');
    }
    const leaveType = (input.leaveType ?? 'annual') as StaffLeaveType;
    const days = inclusiveLeaveDays(input.startDate, input.endDate);

    // Soft-check: when a balance row exists and is insufficient, reject create.
    if (requiresBalance(leaveType)) {
      const balance = await this.repository.getBalance(tenantId, input.staffId, leaveType);
      if (balance && balance.balanceDays < days) {
        throw new BusinessRuleError(
          `Insufficient ${leaveType} leave balance: need ${days} day(s), have ${balance.balanceDays}`,
        );
      }
    }

    return this.repository.createLeave({
      id: uuidv4(),
      tenantId,
      staffId: input.staffId,
      leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason ?? null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
    });
  }

  /** PRC-M379: bounded list with total. */
  async listLeavesPage(tenantId: string, window: { limit: number; offset: number }) {
    return this.repository.listLeavesPage(tenantId, window);
  }

  async listLeaves(tenantId: string) {
    return this.repository.listLeaves(tenantId);
  }

  async decideLeave(
    tenantId: string,
    leaveId: string,
    input: DecideStaffLeaveInput,
    actorId: string,
  ): Promise<StaffLeaveEntity> {
    const leave = await this.repository.findLeaveById(leaveId, tenantId);
    if (!leave) {
      throw new NotFoundError(`Leave with id '${leaveId}' not found`);
    }
    if (leave.status !== 'pending') {
      throw new ConflictError(`Leave is already ${leave.status}`);
    }
    const status = input.status as StaffLeaveStatus;
    const debitDays =
      status === 'approved' && requiresBalance(leave.leaveType)
        ? inclusiveLeaveDays(leave.startDate, leave.endDate)
        : null;
    // PRC-M372: lock + pending check + balance debit + guarded status update run
    // in one transaction, so concurrent approvals debit once and a failed status
    // write rolls the debit back.
    try {
      const updated = await this.repository.decideLeaveAtomically(tenantId, leaveId, {
        status,
        decidedBy: actorId,
        decidedAt: new Date(),
        debitDays,
      });
      if (!updated) throw new NotFoundError(`Leave with id '${leaveId}' not found`);
      return updated;
    } catch (error) {
      if (error instanceof LeaveNotPendingError) throw new ConflictError(error.message);
      if (error instanceof InsufficientLeaveBalanceError) {
        throw new BusinessRuleError(error.message);
      }
      if (error instanceof LeaveBalanceMissingError) {
        // PRC-H091: a missing balance row is a configuration gap, not "0 days".
        throw new BusinessRuleError(
          `No ${leave.leaveType} leave balance is configured for staff '${leave.staffId}'; ` +
            'set it via PUT /staff/:id/leave-balances before approving',
        );
      }
      throw error;
    }
  }
}
