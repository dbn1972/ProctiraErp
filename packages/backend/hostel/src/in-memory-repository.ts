/**
 * In-memory hostel repository (v1 gateway default).
 */
import type {
  HostelAssignmentEntity,
  HostelBedEntity,
  HostelBlockEntity,
  HostelEntity,
  HostelLeaveEntity,
  HostelRepository,
  HostelRoomEntity,
  HostelVisitorEntity,
} from './hostel-repository.js';

export class InMemoryHostelRepository implements HostelRepository {
  private hostels: HostelEntity[] = [];
  private assignments: HostelAssignmentEntity[] = [];
  private leaves: HostelLeaveEntity[] = [];
  private visitors: HostelVisitorEntity[] = [];
  private blocks: HostelBlockEntity[] = [];
  private rooms: HostelRoomEntity[] = [];
  private beds: HostelBedEntity[] = [];

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

  async findLeaveById(id: string, tenantId: string): Promise<HostelLeaveEntity | null> {
    return this.leaves.find((l) => l.id === id && l.tenantId === tenantId) ?? null;
  }

  async updateLeave(
    id: string,
    tenantId: string,
    data: Partial<Pick<HostelLeaveEntity, 'status'>>,
  ): Promise<HostelLeaveEntity | null> {
    const index = this.leaves.findIndex((l) => l.id === id && l.tenantId === tenantId);
    if (index === -1) return null;
    const updated: HostelLeaveEntity = {
      ...this.leaves[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.leaves[index] = updated;
    return updated;
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

  async findVisitorById(id: string, tenantId: string): Promise<HostelVisitorEntity | null> {
    return this.visitors.find((v) => v.id === id && v.tenantId === tenantId) ?? null;
  }

  async updateVisitor(
    id: string,
    tenantId: string,
    data: Partial<Pick<HostelVisitorEntity, 'status'>>,
  ): Promise<HostelVisitorEntity | null> {
    const index = this.visitors.findIndex((v) => v.id === id && v.tenantId === tenantId);
    if (index === -1) return null;
    const updated: HostelVisitorEntity = {
      ...this.visitors[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.visitors[index] = updated;
    return updated;
  }

  async createBlock(
    data: Omit<HostelBlockEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelBlockEntity> {
    const now = new Date();
    const entity: HostelBlockEntity = { ...data, createdAt: now, updatedAt: now };
    this.blocks.push(entity);
    return entity;
  }

  async listBlocks(tenantId: string, hostelId?: string): Promise<HostelBlockEntity[]> {
    return this.blocks.filter(
      (b) => b.tenantId === tenantId && (hostelId === undefined || b.hostelId === hostelId),
    );
  }

  async createRoom(
    data: Omit<HostelRoomEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelRoomEntity> {
    const now = new Date();
    const entity: HostelRoomEntity = { ...data, createdAt: now, updatedAt: now };
    this.rooms.push(entity);
    return entity;
  }

  async listRooms(tenantId: string, blockId?: string): Promise<HostelRoomEntity[]> {
    return this.rooms.filter(
      (r) => r.tenantId === tenantId && (blockId === undefined || r.blockId === blockId),
    );
  }

  async createBed(
    data: Omit<HostelBedEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelBedEntity> {
    const now = new Date();
    const entity: HostelBedEntity = { ...data, createdAt: now, updatedAt: now };
    this.beds.push(entity);
    return entity;
  }

  async listBeds(tenantId: string, roomId?: string): Promise<HostelBedEntity[]> {
    return this.beds.filter(
      (b) => b.tenantId === tenantId && (roomId === undefined || b.roomId === roomId),
    );
  }

  async findBedById(id: string, tenantId: string): Promise<HostelBedEntity | null> {
    return this.beds.find((b) => b.id === id && b.tenantId === tenantId) ?? null;
  }

  async updateBed(
    id: string,
    tenantId: string,
    data: Partial<Pick<HostelBedEntity, 'isAvailable'>>,
  ): Promise<HostelBedEntity | null> {
    const index = this.beds.findIndex((b) => b.id === id && b.tenantId === tenantId);
    if (index === -1) return null;
    const updated: HostelBedEntity = {
      ...this.beds[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.beds[index] = updated;
    return updated;
  }
}
