/**
 * In-memory staff leave repository.
 */
import {
  InsufficientLeaveBalanceError,
  type StaffLeaveBalanceEntity,
  type StaffLeaveEntity,
  type StaffLeaveRepository,
  type StaffLeaveType,
} from './leave-repository.js';

export class InMemoryStaffLeaveRepository implements StaffLeaveRepository {
  private leaves: StaffLeaveEntity[] = [];
  private balances = new Map<string, StaffLeaveBalanceEntity>();

  private balanceKey(tenantId: string, staffId: string, leaveType: StaffLeaveType): string {
    return `${tenantId}:${staffId}:${leaveType}`;
  }

  async createLeave(
    data: Omit<StaffLeaveEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<StaffLeaveEntity> {
    const now = new Date();
    const entity: StaffLeaveEntity = { ...data, createdAt: now, updatedAt: now };
    this.leaves.push(entity);
    return entity;
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
}
