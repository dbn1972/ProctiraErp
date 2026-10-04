/**
 * Staff HR leave service — create, list, approve/reject with balances (G-206).
 */
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import {
  InsufficientLeaveBalanceError,
  type StaffLeaveBalanceEntity,
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

  /**
   * PRC-H091: bulk opening-balance import. Rows are validated up-front (duplicate
   * staffId+leaveType, staff existence in the tenant); any error rejects the whole batch.
   * Writes use the repository's single-transaction upsert when available.
   */
  async importOpeningBalances(
    tenantId: string,
    rows: readonly { staffId: string; leaveType: StaffLeaveType; balanceDays: number }[],
    staffExists: (tenantId: string, staffId: string) => Promise<boolean>,
    options: { dryRun?: boolean } = {},
  ): Promise<{ dryRun: boolean; imported: number; balances: StaffLeaveBalanceEntity[] }> {
    const errors: { field: string; rule: string; message: string }[] = [];
    const seen = new Map<string, number>();
    rows.forEach((row, i) => {
      const key = `${row.staffId}:${row.leaveType}`;
      const prior = seen.get(key);
      if (prior !== undefined) {
        errors.push({
          field: `rows[${i}]`,
          rule: 'duplicate',
          message: `Duplicate ${row.leaveType} balance for staff '${row.staffId}' (also rows[${prior}])`,
        });
      } else {
        seen.set(key, i);
      }
    });
    const uniqueStaff = [...new Set(rows.map((r) => r.staffId))];
    const missing = new Set<string>();
    for (const staffId of uniqueStaff) {
      if (!(await staffExists(tenantId, staffId))) missing.add(staffId);
    }
    rows.forEach((row, i) => {
      if (missing.has(row.staffId)) {
        errors.push({
          field: `rows[${i}].staffId`,
          rule: 'not_found',
          message: `Staff with id '${row.staffId}' not found`,
        });
      }
    });
    if (errors.length > 0) {
      throw new ValidationError(
        'Opening-balance import rejected; no balances were written',
        errors,
      );
    }
    if (options.dryRun) return { dryRun: true, imported: 0, balances: [] };
    let balances: StaffLeaveBalanceEntity[];
    if (this.repository.setBalancesAtomic) {
      balances = await this.repository.setBalancesAtomic(tenantId, rows);
    } else {
      balances = [];
      for (const row of rows) {
        balances.push(
          await this.repository.setBalance(tenantId, row.staffId, row.leaveType, row.balanceDays),
        );
      }
    }
    return { dryRun: false, imported: balances.length, balances };
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
      // G-718: the decrement itself is the authoritative check — the repository
      // locks the balance row (FOR UPDATE) and rejects a negative result, so two
      // concurrent approvals cannot both consume the same days.
      // PRC-H091: a missing balance row is a configuration gap, not "0 days".
      const balance = await this.repository.getBalance(tenantId, leave.staffId, leave.leaveType);
      if (!balance) {
        throw new BusinessRuleError(
          `No ${leave.leaveType} leave balance is configured for staff '${leave.staffId}'; ` +
            'set it via PUT /staff/:id/leave-balances before approving',
        );
      }
      try {
        await this.repository.adjustBalance(tenantId, leave.staffId, leave.leaveType, -days);
      } catch (error) {
        if (error instanceof InsufficientLeaveBalanceError) {
          throw new BusinessRuleError(error.message);
        }
        throw error;
      }
    }

    const updated = await this.repository.updateLeave(leaveId, tenantId, {
      status,
      decidedBy: actorId,
      decidedAt: new Date(),
    });
    return updated!;
  }
}
