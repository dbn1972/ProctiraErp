/**
 * In-memory hostel repository (v1 gateway default).
 */
import type {
  HostelAssignmentEntity,
  HostelEntity,
  HostelLeaveEntity,
  HostelRepository,
  HostelVisitorEntity,
} from './hostel-repository.js';

export class InMemoryHostelRepository implements HostelRepository {
  private hostels: HostelEntity[] = [];
  private assignments: HostelAssignmentEntity[] = [];
  private leaves: HostelLeaveEntity[] = [];
  private visitors: HostelVisitorEntity[] = [];

  async createHostel(data: Omit<HostelEntity, 'createdAt' | 'updatedAt'>): Promise<HostelEntity> {
    const now = new Date();
    const entity: HostelEntity = { ...data, createdAt: now, updatedAt: now };
    this.hostels.push(entity);
    return entity;
  }

  async listHostels(tenantId: string): Promise<HostelEntity[]> {
    return this.hostels.filter((h) => h.tenantId === tenantId);
  }

  async findHostelById(id: string, tenantId: string): Promise<HostelEntity | null> {
    return this.hostels.find((h) => h.id === id && h.tenantId === tenantId) ?? null;
  }

  async createAssignment(
    data: Omit<HostelAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelAssignmentEntity> {
    const now = new Date();
    const entity: HostelAssignmentEntity = { ...data, createdAt: now, updatedAt: now };
    this.assignments.push(entity);
    return entity;
  }

  async listAssignments(tenantId: string): Promise<HostelAssignmentEntity[]> {
    return this.assignments.filter((a) => a.tenantId === tenantId);
  }

  async createLeave(
    data: Omit<HostelLeaveEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelLeaveEntity> {
    const now = new Date();
    const entity: HostelLeaveEntity = { ...data, createdAt: now, updatedAt: now };
    this.leaves.push(entity);
    return entity;
  }

  async listLeaves(tenantId: string): Promise<HostelLeaveEntity[]> {
    return this.leaves.filter((l) => l.tenantId === tenantId);
  }

  async createVisitor(
    data: Omit<HostelVisitorEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelVisitorEntity> {
    const now = new Date();
    const entity: HostelVisitorEntity = { ...data, createdAt: now, updatedAt: now };
    this.visitors.push(entity);
    return entity;
  }

  async listVisitors(tenantId: string): Promise<HostelVisitorEntity[]> {
    return this.visitors.filter((v) => v.tenantId === tenantId);
  }
}
