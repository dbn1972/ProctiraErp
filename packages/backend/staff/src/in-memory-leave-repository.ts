/**
 * In-memory staff leave repository.
 */
import type { StaffLeaveEntity, StaffLeaveRepository } from './leave-repository.js';

export class InMemoryStaffLeaveRepository implements StaffLeaveRepository {
  private leaves: StaffLeaveEntity[] = [];

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
}
