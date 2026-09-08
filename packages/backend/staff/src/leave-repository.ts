/**
 * Staff leave repository contract (HR leave v1).
 */
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

export interface StaffLeaveRepository {
  createLeave(data: Omit<StaffLeaveEntity, 'createdAt' | 'updatedAt'>): Promise<StaffLeaveEntity>;
  listLeaves(tenantId: string): Promise<StaffLeaveEntity[]>;
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
