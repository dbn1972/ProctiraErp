/**
 * In-memory hostel repository (v1 gateway default).
 */
import {
  BedAssignmentConflictError,
  type GatePassEntity,
  type HostelAssignmentEntity,
  type HostelAttendanceEntity,
  type HostelBedEntity,
  type HostelBlockEntity,
  type HostelEntity,
  type HostelFeeStructureEntity,
  type HostelLeaveEntity,
  type HostelRepository,
  type HostelRoomEntity,
  type HostelVisitorEntity,
  type MessMenuItemEntity,
  type MessPlanEntity,
  type MessSubscriptionEntity,
  type NewGatePass,
  type NewHostelAttendance,
  type NewHostelFeeStructure,
  type NewMessMenuItem,
  type NewMessPlan,
  type NewMessSubscription,
} from './hostel-repository.js';

export class InMemoryHostelRepository implements HostelRepository {
  private hostels: HostelEntity[] = [];
  private assignments: HostelAssignmentEntity[] = [];
  private leaves: HostelLeaveEntity[] = [];
  private visitors: HostelVisitorEntity[] = [];
  private blocks: HostelBlockEntity[] = [];
  private rooms: HostelRoomEntity[] = [];
  private beds: HostelBedEntity[] = [];
  private messPlans: MessPlanEntity[] = [];
  private messMenu: MessMenuItemEntity[] = [];
  private messSubs: MessSubscriptionEntity[] = [];
  private gatePasses: GatePassEntity[] = [];
  private feeStructures: HostelFeeStructureEntity[] = [];
  private attendance: HostelAttendanceEntity[] = [];

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

  async createActiveAssignment(
    data: Omit<HostelAssignmentEntity, 'createdAt' | 'updatedAt'> & { isActive: true },
  ): Promise<HostelAssignmentEntity> {
    // No await between check and write — concurrent callers serialize on the
    // sync critical section (same invariant as Pg FOR UPDATE).
    const bedIndex = this.beds.findIndex((b) => b.id === data.bedId && b.tenantId === data.tenantId);
    if (bedIndex === -1) {
      throw new BedAssignmentConflictError('BED_UNAVAILABLE', 'Bed not found for assignment');
    }
    const bed = this.beds[bedIndex]!;
    if (!bed.isAvailable) {
      throw new BedAssignmentConflictError(
        'BED_UNAVAILABLE',
        'Bed is not available for assignment',
      );
    }
    const studentBusy = this.assignments.some(
      (a) => a.tenantId === data.tenantId && a.studentId === data.studentId && a.isActive,
    );
    if (studentBusy) {
      throw new BedAssignmentConflictError(
        'STUDENT_ALREADY_ASSIGNED',
        'Student already has an active bed assignment',
      );
    }
    const bedBusy = this.assignments.some(
      (a) => a.tenantId === data.tenantId && a.bedId === data.bedId && a.isActive,
    );
    if (bedBusy) {
      throw new BedAssignmentConflictError(
        'BED_UNAVAILABLE',
        'Bed is not available for assignment',
      );
    }

    const now = new Date();
    this.beds[bedIndex] = { ...bed, isAvailable: false, updatedAt: now };
    const entity: HostelAssignmentEntity = {
      ...data,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
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

  async createMessPlan(data: NewMessPlan): Promise<MessPlanEntity> {
    const now = new Date();
    const entity: MessPlanEntity = { ...data, createdAt: now, updatedAt: now };
    this.messPlans.push(entity);
    return entity;
  }

  async listMessPlans(tenantId: string, hostelId?: string): Promise<MessPlanEntity[]> {
    return this.messPlans.filter(
      (p) => p.tenantId === tenantId && (hostelId === undefined || p.hostelId === hostelId),
    );
  }

  async findMessPlanById(id: string, tenantId: string): Promise<MessPlanEntity | null> {
    return this.messPlans.find((p) => p.id === id && p.tenantId === tenantId) ?? null;
  }

  async createMessMenuItem(data: NewMessMenuItem): Promise<MessMenuItemEntity> {
    const now = new Date();
    const entity: MessMenuItemEntity = { ...data, createdAt: now, updatedAt: now };
    this.messMenu.push(entity);
    return entity;
  }

  async listMessMenuItems(tenantId: string, planId: string): Promise<MessMenuItemEntity[]> {
    return this.messMenu.filter((m) => m.tenantId === tenantId && m.planId === planId);
  }

  async createMessSubscription(data: NewMessSubscription): Promise<MessSubscriptionEntity> {
    const now = new Date();
    const entity: MessSubscriptionEntity = { ...data, createdAt: now, updatedAt: now };
    this.messSubs.push(entity);
    return entity;
  }

  async listMessSubscriptions(
    tenantId: string,
    planId?: string,
  ): Promise<MessSubscriptionEntity[]> {
    return this.messSubs.filter(
      (s) => s.tenantId === tenantId && (planId === undefined || s.planId === planId),
    );
  }

  async createGatePass(data: NewGatePass): Promise<GatePassEntity> {
    const now = new Date();
    const entity: GatePassEntity = { ...data, createdAt: now, updatedAt: now };
    this.gatePasses.push(entity);
    return entity;
  }

  async listGatePasses(tenantId: string, hostelId?: string): Promise<GatePassEntity[]> {
    return this.gatePasses.filter(
      (g) => g.tenantId === tenantId && (hostelId === undefined || g.hostelId === hostelId),
    );
  }

  async findGatePassById(id: string, tenantId: string): Promise<GatePassEntity | null> {
    return this.gatePasses.find((g) => g.id === id && g.tenantId === tenantId) ?? null;
  }

  async updateGatePass(
    id: string,
    tenantId: string,
    data: Partial<Pick<GatePassEntity, 'status' | 'decidedBy' | 'outAt' | 'inAt'>>,
  ): Promise<GatePassEntity | null> {
    const index = this.gatePasses.findIndex((g) => g.id === id && g.tenantId === tenantId);
    if (index === -1) return null;
    const updated: GatePassEntity = {
      ...this.gatePasses[index]!,
      ...data,
      updatedAt: new Date(),
    };
    this.gatePasses[index] = updated;
    return updated;
  }

  async createFeeStructure(data: NewHostelFeeStructure): Promise<HostelFeeStructureEntity> {
    const now = new Date();
    const entity: HostelFeeStructureEntity = { ...data, createdAt: now, updatedAt: now };
    this.feeStructures.push(entity);
    return entity;
  }

  async listFeeStructures(
    tenantId: string,
    hostelId?: string,
  ): Promise<HostelFeeStructureEntity[]> {
    return this.feeStructures.filter(
      (f) => f.tenantId === tenantId && (hostelId === undefined || f.hostelId === hostelId),
    );
  }

  async upsertAttendance(data: NewHostelAttendance): Promise<HostelAttendanceEntity> {
    const index = this.attendance.findIndex(
      (a) =>
        a.tenantId === data.tenantId &&
        a.blockId === data.blockId &&
        a.studentId === data.studentId &&
        a.onDate === data.onDate,
    );
    const now = new Date();
    if (index === -1) {
      const entity: HostelAttendanceEntity = { ...data, createdAt: now, updatedAt: now };
      this.attendance.push(entity);
      return entity;
    }
    const updated: HostelAttendanceEntity = {
      ...this.attendance[index]!,
      status: data.status,
      reason: data.reason,
      updatedAt: now,
    };
    this.attendance[index] = updated;
    return updated;
  }

  async listAttendance(
    tenantId: string,
    blockId: string,
    onDate: string,
  ): Promise<HostelAttendanceEntity[]> {
    return this.attendance.filter(
      (a) => a.tenantId === tenantId && a.blockId === blockId && a.onDate === onDate,
    );
  }
}
