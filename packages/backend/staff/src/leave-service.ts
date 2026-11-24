/**
 * Staff HR leave service — create, list, approve/reject with balances (G-206).
 */
import { BusinessRuleError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import {
  InsufficientLeaveBalanceError,
  LeaveBalanceMissingError,
  LeaveNotCancellableError,
  LeaveNotPendingError,
  LeaveOverlapError,
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
import { emitStaffAudit, type StaffAuditOptions } from './staff-audit.js';
import { assertStaffInTenant, type StaffExistsCheck } from './staff-reference.js';

/**
 * PRC-M373: a real calendar date in strict `YYYY-MM-DD` form. `Date.parse`
 * alone accepts impossible days such as 2026-02-30 by rolling them over, so
 * the parsed value must round-trip to the same string.
 */
export function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

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
    /** PRC-M544: leave decisions are audited (no sink: unchanged behaviour). */
    private readonly options: StaffAuditOptions = {},
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
    // PRC-M373: reject impossible dates (2026-02-30, 2026-13-01) before anything else.
    const badDates = (['startDate', 'endDate'] as const).filter(
      (f) => !isIsoCalendarDate(input[f]),
    );
    if (badDates.length > 0) {
      throw new ValidationError(
        'Leave dates must be real calendar dates (YYYY-MM-DD)',
        badDates.map((field) => ({
          field,
          rule: 'date',
          message: `${field} must be a real calendar date in YYYY-MM-DD form`,
        })),
      );
    }
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

    try {
      return await this.repository.createLeave({
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
    } catch (error) {
      // PRC-M373: one pending/approved leave per staff member per day.
      if (error instanceof LeaveOverlapError) throw new ConflictError(error.message);
      throw error;
    }
  }

  /** PRC-M379: bounded list with total. */
  async listLeavesPage(tenantId: string, window: { limit: number; offset: number }) {
    return this.repository.listLeavesPage(tenantId, window);
  }

  async listLeaves(tenantId: string) {
    return this.repository.listLeaves(tenantId);
  }

  /** PRC-H090: resolve a leave (for school-scope checks). */
  async getLeave(tenantId: string, leaveId: string): Promise<StaffLeaveEntity> {
    const leave = await this.repository.findLeaveById(leaveId, tenantId);
    if (!leave) {
      throw new NotFoundError(`Leave with id '${leaveId}' not found`);
    }
    return leave;
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
    // PRC-M373: separation of duties: nobody decides their own leave.
    if (await this.repository.isStaffLinkedToPrincipal(tenantId, leave.staffId, actorId)) {
      throw new ConflictError('A leave request cannot be decided by the staff member it is for');
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
      await emitStaffAudit(this.options.auditSink, {
        tenantId,
        action: 'leave.decide',
        entityType: 'staff_leave',
        entityId: leaveId,
        actorId,
        operation: 'UPDATE',
        before: { status: leave.status },
        after: { status: updated.status, debitDays },
        metadata: { staffId: leave.staffId, leaveType: leave.leaveType },
      });
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

  /**
   * PRC-M373: cancel a pending or approved leave. Cancelling an approved
   * balance-tracked leave credits back the days its approval debited, in the
   * same transaction as the status change.
   */
  async cancelLeave(tenantId: string, leaveId: string, actorId: string): Promise<StaffLeaveEntity> {
    const leave = await this.repository.findLeaveById(leaveId, tenantId);
    if (!leave) {
      throw new NotFoundError(`Leave with id '${leaveId}' not found`);
    }
    const creditDaysIfApproved = requiresBalance(leave.leaveType)
      ? inclusiveLeaveDays(leave.startDate, leave.endDate)
      : null;
    try {
      const result = await this.repository.cancelLeaveAtomically(tenantId, leaveId, {
        cancelledBy: actorId,
        cancelledAt: new Date(),
        creditDaysIfApproved,
      });
      if (!result) throw new NotFoundError(`Leave with id '${leaveId}' not found`);
      await emitStaffAudit(this.options.auditSink, {
        tenantId,
        action: 'leave.cancel',
        entityType: 'staff_leave',
        entityId: leaveId,
        actorId,
        operation: 'UPDATE',
        before: { status: result.previousStatus },
        after: { status: result.leave.status, creditedDays: result.creditedDays },
        metadata: { staffId: leave.staffId, leaveType: leave.leaveType },
      });
      return result.leave;
    } catch (error) {
      if (error instanceof LeaveNotCancellableError) throw new ConflictError(error.message);
      throw error;
    }
  }
}
