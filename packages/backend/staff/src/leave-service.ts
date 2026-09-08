/**
 * Staff HR leave service — create, list, approve/reject with balances (G-206).
 */
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  StaffLeaveEntity,
  StaffLeaveRepository,
  StaffLeaveStatus,
  StaffLeaveType,
} from './leave-repository.js';
import type { CreateStaffLeaveInput, DecideStaffLeaveInput } from './leave-schemas.js';

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
  constructor(private readonly repository: StaffLeaveRepository) {}

  async getBalance(tenantId: string, staffId: string, leaveType: StaffLeaveType) {
    return this.repository.getBalance(tenantId, staffId, leaveType);
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

    if (status === 'approved' && requiresBalance(leave.leaveType)) {
      const days = inclusiveLeaveDays(leave.startDate, leave.endDate);
      const balance = await this.repository.getBalance(
        tenantId,
        leave.staffId,
        leave.leaveType,
      );
      const available = balance?.balanceDays ?? 0;
      if (available < days) {
        throw new BusinessRuleError(
          `Insufficient ${leave.leaveType} leave balance: need ${days} day(s), have ${available}`,
        );
      }
      await this.repository.adjustBalance(tenantId, leave.staffId, leave.leaveType, -days);
    }

    const updated = await this.repository.updateLeave(leaveId, tenantId, {
      status,
      decidedBy: actorId,
      decidedAt: new Date(),
    });
    return updated!;
  }
}
