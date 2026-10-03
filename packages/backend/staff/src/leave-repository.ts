/**
 * Staff leave repository contract (HR leave v1).
 */
import type { PagedRows, PageWindow } from './hr-store.js';
export type StaffLeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type StaffLeaveType = 'annual' | 'sick' | 'casual' | 'unpaid' | 'other';

export interface StaffLeaveEntity {
  id: string;
  tenantId: string;
  staffId: string;
  leaveType: StaffLeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: StaffLeaveStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffLeaveBalanceEntity {
  tenantId: string;
  staffId: string;
  leaveType: StaffLeaveType;
  balanceDays: number;
  updatedAt: Date;
}

/**
 * Thrown by `adjustBalance` when the atomic decrement would drive the balance
 * below zero (G-718). Repositories MUST make this check inside the same lock /
 * transaction as the write so concurrent approvals cannot both pass.
 */
export class InsufficientLeaveBalanceError extends Error {
  constructor(
    public readonly leaveType: StaffLeaveType,
    public readonly requestedDays: number,
    public readonly availableDays: number,
  ) {
    super(
      `Insufficient ${leaveType} leave balance: need ${requestedDays} day(s), have ${availableDays}`,
    );
    this.name = 'InsufficientLeaveBalanceError';
  }
}

/** PRC-M372: the leave was no longer pending when the decision committed. */
export class LeaveNotPendingError extends Error {
  constructor(public readonly currentStatus: StaffLeaveStatus) {
    super(`Leave is already ${currentStatus}`);
    this.name = 'LeaveNotPendingError';
  }
}

/** PRC-M372: approval needs a configured balance row (PRC-H091). */
export class LeaveBalanceMissingError extends Error {
  constructor(
    public readonly staffId: string,
    public readonly leaveType: StaffLeaveType,
  ) {
    super(`No ${leaveType} leave balance is configured for staff '${staffId}'`);
    this.name = 'LeaveBalanceMissingError';
  }
}

export interface DecideLeaveAtomicInput {
  status: StaffLeaveStatus;
  decidedBy: string;
  decidedAt: Date;
  /** Days to debit from the leave's balance (approve of a balance-tracked type). */
  debitDays: number | null;
}

export interface StaffLeaveRepository {
  /**
   * PRC-M372: in ONE transaction lock the leave, verify it is pending, debit the
   * balance (when debitDays is set) and update the status with a
   * `status = 'pending'` guard. Returns null when the leave does not exist.
   * Throws {@link LeaveNotPendingError}, {@link LeaveBalanceMissingError} or
   * {@link InsufficientLeaveBalanceError}; any failure rolls back the debit.
   */
  decideLeaveAtomically(
    tenantId: string,
    leaveId: string,
    input: DecideLeaveAtomicInput,
  ): Promise<StaffLeaveEntity | null>;
  createLeave(data: Omit<StaffLeaveEntity, 'createdAt' | 'updatedAt'>): Promise<StaffLeaveEntity>;
  listLeaves(tenantId: string): Promise<StaffLeaveEntity[]>;
  /** PRC-M379: bounded list with total for GET /staff/leaves. */
  listLeavesPage(tenantId: string, window: PageWindow): Promise<PagedRows<StaffLeaveEntity>>;
  findLeaveById(id: string, tenantId: string): Promise<StaffLeaveEntity | null>;
  updateLeave(
    id: string,
    tenantId: string,
    data: Partial<Pick<StaffLeaveEntity, 'status' | 'decidedBy' | 'decidedAt'>>,
  ): Promise<StaffLeaveEntity | null>;

  /** Leave balance (schema 018) — missing row treated as 0 by callers. */
  getBalance(
    tenantId: string,
    staffId: string,
    leaveType: StaffLeaveType,
  ): Promise<StaffLeaveBalanceEntity | null>;
  setBalance(
    tenantId: string,
    staffId: string,
    leaveType: StaffLeaveType,
    balanceDays: number,
  ): Promise<StaffLeaveBalanceEntity>;
  /**
   * Atomically add `deltaDays` (negative to consume). Must lock the balance row
   * (`SELECT … FOR UPDATE`) and throw {@link InsufficientLeaveBalanceError}
   * when the result would be negative.
   */
  adjustBalance(
    tenantId: string,
    staffId: string,
    leaveType: StaffLeaveType,
    deltaDays: number,
  ): Promise<StaffLeaveBalanceEntity>;
}
