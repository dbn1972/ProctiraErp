/**
 * In-memory staff leave repository.
 */
import { pageSlice, type PageWindow } from './hr-store.js';
import {
  InsufficientLeaveBalanceError,
  LeaveBalanceMissingError,
  LeaveNotCancellableError,
  LeaveNotPendingError,
  LeaveOverlapError,
  type CancelLeaveAtomicInput,
  type CancelLeaveResult,
  type DecideLeaveAtomicInput,
  type StaffLeaveBalanceEntity,
  type StaffLeaveEntity,
  type StaffLeaveRepository,
  type StaffLeaveType,
} from './leave-repository.js';

export class InMemoryStaffLeaveRepository implements StaffLeaveRepository {
  private leaves: StaffLeaveEntity[] = [];
  private balances = new Map<string, StaffLeaveBalanceEntity>();
  /** PRC-M373: staffId -> principal (`staff.user_id`); staff entities carry no userId. */
  private readonly principalLinks = new Map<string, string>();

  /** Test helper: link a staff id to the login (`staff.user_id`) it belongs to. */
  linkPrincipalToStaff(principalId: string, staffId: string): void {
    this.principalLinks.set(staffId, principalId);
  }

  async isStaffLinkedToPrincipal(
    _tenantId: string,
    staffId: string,
    principalId: string,
  ): Promise<boolean> {
    return this.principalLinks.get(staffId) === principalId;
  }

  private balanceKey(tenantId: string, staffId: string, leaveType: StaffLeaveType): string {
    return `${tenantId}:${staffId}:${leaveType}`;
  }

  async createLeave(
    data: Omit<StaffLeaveEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StaffLeaveEntity> {
    // PRC-M373: mirrors the staff_leave_requests_no_overlap_excl EXCLUDE (db/sql/311).
    // No await between check and write: atomic on the single JS thread.
    const blocks = (status: string) => status === 'pending' || status === 'approved';
    if (
      blocks(data.status) &&
      this.leaves.some(
        (l) =>
          l.tenantId === data.tenantId &&
          l.staffId === data.staffId &&
          blocks(l.status) &&
          l.startDate <= data.endDate &&
          data.startDate <= l.endDate,
      )
    ) {
      throw new LeaveOverlapError(data.staffId, data.startDate, data.endDate);
    }
    const now = new Date();
    const entity: StaffLeaveEntity = { ...data, createdAt: now, updatedAt: now };
    this.leaves.push(entity);
    return entity;
  }

  async listLeavesPage(tenantId: string, window: PageWindow) {
    return pageSlice(await this.listLeaves(tenantId), window);
  }

  async listLeaves(tenantId: string): Promise<StaffLeaveEntity[]> {
    return this.leaves
      .filter((leave) => leave.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async findLeaveById(id: string, tenantId: string): Promise<StaffLeaveEntity | null> {
    return this.leaves.find((leave) => leave.id === id && leave.tenantId === tenantId) ?? null;
  }

  async updateLeave(
    id: string,
    tenantId: string,
    data: Partial<Pick<StaffLeaveEntity, 'status' | 'decidedBy' | 'decidedAt'>>,
  ): Promise<StaffLeaveEntity | null> {
    const index = this.leaves.findIndex((leave) => leave.id === id && leave.tenantId === tenantId);
    if (index === -1) return null;
    const updated: StaffLeaveEntity = {
      ...this.leaves[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.leaves[index] = updated;
    return updated;
  }

  async getBalance(
    tenantId: string,
    staffId: string,
    leaveType: StaffLeaveType,
  ): Promise<StaffLeaveBalanceEntity | null> {
    return this.balances.get(this.balanceKey(tenantId, staffId, leaveType)) ?? null;
  }

  async setBalance(
    tenantId: string,
    staffId: string,
    leaveType: StaffLeaveType,
    balanceDays: number,
  ): Promise<StaffLeaveBalanceEntity> {
    if (balanceDays < 0) {
      throw new Error('balanceDays must be >= 0');
    }
    const entity: StaffLeaveBalanceEntity = {
      tenantId,
      staffId,
      leaveType,
      balanceDays,
      updatedAt: new Date(),
    };
    this.balances.set(this.balanceKey(tenantId, staffId, leaveType), entity);
    return { ...entity };
  }

  async adjustBalance(
    tenantId: string,
    staffId: string,
    leaveType: StaffLeaveType,
    deltaDays: number,
  ): Promise<StaffLeaveBalanceEntity> {
    const current = await this.getBalance(tenantId, staffId, leaveType);
    const available = current?.balanceDays ?? 0;
    const next = available + deltaDays;
    if (next < 0) {
      throw new InsufficientLeaveBalanceError(leaveType, -deltaDays, available);
    }
    return this.setBalance(tenantId, staffId, leaveType, next);
  }
  async decideLeaveAtomically(
    tenantId: string,
    leaveId: string,
    input: DecideLeaveAtomicInput,
  ): Promise<StaffLeaveEntity | null> {
    // No await between check and write: atomic on the single JS thread.
    const index = this.leaves.findIndex((l) => l.id === leaveId && l.tenantId === tenantId);
    if (index === -1) return null;
    const leave = this.leaves[index]!;
    if (leave.status !== 'pending') throw new LeaveNotPendingError(leave.status);
    let nextBalance: StaffLeaveBalanceEntity | null = null;
    if (input.debitDays !== null && input.debitDays > 0) {
      const key = this.balanceKey(tenantId, leave.staffId, leave.leaveType);
      const current = this.balances.get(key);
      if (!current) throw new LeaveBalanceMissingError(leave.staffId, leave.leaveType);
      const next = current.balanceDays - input.debitDays;
      if (next < 0) {
        throw new InsufficientLeaveBalanceError(
          leave.leaveType,
          input.debitDays,
          current.balanceDays,
        );
      }
      nextBalance = { ...current, balanceDays: next, updatedAt: new Date() };
    }
    const updated: StaffLeaveEntity = {
      ...leave,
      status: input.status,
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      updatedAt: new Date(),
    };
    if (nextBalance) {
      this.balances.set(this.balanceKey(tenantId, leave.staffId, leave.leaveType), nextBalance);
    }
    this.leaves[index] = updated;
    return updated;
  }

  async cancelLeaveAtomically(
    tenantId: string,
    leaveId: string,
    input: CancelLeaveAtomicInput,
  ): Promise<CancelLeaveResult | null> {
    // No await between check and write: atomic on the single JS thread.
    const index = this.leaves.findIndex((l) => l.id === leaveId && l.tenantId === tenantId);
    if (index === -1) return null;
    const leave = this.leaves[index]!;
    if (leave.status !== 'pending' && leave.status !== 'approved') {
      throw new LeaveNotCancellableError(leave.status);
    }
    let creditedDays = 0;
    if (
      leave.status === 'approved' &&
      input.creditDaysIfApproved &&
      input.creditDaysIfApproved > 0
    ) {
      const key = this.balanceKey(tenantId, leave.staffId, leave.leaveType);
      const current = this.balances.get(key);
      this.balances.set(key, {
        tenantId,
        staffId: leave.staffId,
        leaveType: leave.leaveType,
        balanceDays: (current?.balanceDays ?? 0) + input.creditDaysIfApproved,
        updatedAt: new Date(),
      });
      creditedDays = input.creditDaysIfApproved;
    }
    const updated: StaffLeaveEntity = { ...leave, status: 'cancelled', updatedAt: new Date() };
    this.leaves[index] = updated;
    return { leave: updated, previousStatus: leave.status, creditedDays };
  }
}
