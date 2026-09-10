/**
 * Hostel repository interface (in-memory v1).
 */

export type HostelStatus = 'active' | 'inactive' | 'maintenance';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type VisitorStatus = 'expected' | 'checked_in' | 'checked_out' | 'denied';

export interface HostelEntity {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  address: string | null;
  capacity: number;
  status: HostelStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostelAssignmentEntity {
  id: string;
  tenantId: string;
  studentId: string;
  bedId: string;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostelLeaveEntity {
  id: string;
  tenantId: string;
  studentId: string;
  hostelId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: LeaveStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostelVisitorEntity {
  id: string;
  tenantId: string;
  hostelId: string;
  visitorName: string;
  studentId: string;
  visitDate: string;
  status: VisitorStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostelBlockEntity {
  id: string;
  tenantId: string;
  hostelId: string;
  name: string;
  floor: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostelRoomEntity {
  id: string;
  tenantId: string;
  blockId: string;
  roomNumber: string;
  capacity: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostelBedEntity {
  id: string;
  tenantId: string;
  roomId: string;
  bedLabel: string;
  isAvailable: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type MessMeal = 'breakfast' | 'lunch' | 'dinner' | 'snacks';
export type MessPlanStatus = 'active' | 'inactive';
export type MessSubscriptionStatus = 'active' | 'paused' | 'cancelled';
export type GatePassStatus = 'pending' | 'approved' | 'rejected' | 'out' | 'in';
export type GatePassRequestedBy = 'resident' | 'parent';
export type HostelAttendanceStatus = 'present' | 'absent' | 'leave';

export interface MessPlanEntity {
  id: string;
  tenantId: string;
  hostelId: string;
  name: string;
  mealCount: number;
  status: MessPlanStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessMenuItemEntity {
  id: string;
  tenantId: string;
  planId: string;
  weekday: number;
  meal: MessMeal;
  itemName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface MessSubscriptionEntity {
  id: string;
  tenantId: string;
  planId: string;
  studentId: string;
  startDate: string;
  endDate: string | null;
  status: MessSubscriptionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface GatePassEntity {
  id: string;
  tenantId: string;
  hostelId: string;
  studentId: string;
  requestedBy: GatePassRequestedBy;
  requesterUserId: string | null;
  reason: string | null;
  expectedOutAt: Date;
  expectedInAt: Date;
  status: GatePassStatus;
  decidedBy: string | null;
  outAt: Date | null;
  inAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostelFeeStructureEntity {
  id: string;
  tenantId: string;
  hostelId: string;
  roomType: string;
  termLabel: string;
  amountCents: number;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface HostelAttendanceEntity {
  id: string;
  tenantId: string;
  blockId: string;
  studentId: string;
  onDate: string;
  status: HostelAttendanceStatus;
  reason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type NewMessPlan = Omit<MessPlanEntity, 'createdAt' | 'updatedAt'>;
export type NewMessMenuItem = Omit<MessMenuItemEntity, 'createdAt' | 'updatedAt'>;
export type NewMessSubscription = Omit<MessSubscriptionEntity, 'createdAt' | 'updatedAt'>;
export type NewGatePass = Omit<GatePassEntity, 'createdAt' | 'updatedAt'>;
export type NewHostelFeeStructure = Omit<HostelFeeStructureEntity, 'createdAt' | 'updatedAt'>;
export type NewHostelAttendance = Omit<HostelAttendanceEntity, 'createdAt' | 'updatedAt'>;

export interface HostelRepository {
  createHostel(data: Omit<HostelEntity, 'createdAt' | 'updatedAt'>): Promise<HostelEntity>;
  listHostels(tenantId: string): Promise<HostelEntity[]>;
  findHostelById(id: string, tenantId: string): Promise<HostelEntity | null>;

  createAssignment(
    data: Omit<HostelAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelAssignmentEntity>;
  listAssignments(tenantId: string): Promise<HostelAssignmentEntity[]>;

  createLeave(data: Omit<HostelLeaveEntity, 'createdAt' | 'updatedAt'>): Promise<HostelLeaveEntity>;
  listLeaves(tenantId: string): Promise<HostelLeaveEntity[]>;
  findLeaveById(id: string, tenantId: string): Promise<HostelLeaveEntity | null>;
  updateLeave(
    id: string,
    tenantId: string,
    data: Partial<Pick<HostelLeaveEntity, 'status'>>,
  ): Promise<HostelLeaveEntity | null>;

  createVisitor(
    data: Omit<HostelVisitorEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelVisitorEntity>;
  listVisitors(tenantId: string): Promise<HostelVisitorEntity[]>;
  findVisitorById(id: string, tenantId: string): Promise<HostelVisitorEntity | null>;
  updateVisitor(
    id: string,
    tenantId: string,
    data: Partial<Pick<HostelVisitorEntity, 'status'>>,
  ): Promise<HostelVisitorEntity | null>;

  createBlock(data: Omit<HostelBlockEntity, 'createdAt' | 'updatedAt'>): Promise<HostelBlockEntity>;
  listBlocks(tenantId: string, hostelId?: string): Promise<HostelBlockEntity[]>;

  createRoom(data: Omit<HostelRoomEntity, 'createdAt' | 'updatedAt'>): Promise<HostelRoomEntity>;
  listRooms(tenantId: string, blockId?: string): Promise<HostelRoomEntity[]>;

  createBed(data: Omit<HostelBedEntity, 'createdAt' | 'updatedAt'>): Promise<HostelBedEntity>;
  listBeds(tenantId: string, roomId?: string): Promise<HostelBedEntity[]>;
  findBedById(id: string, tenantId: string): Promise<HostelBedEntity | null>;
  updateBed(
    id: string,
    tenantId: string,
    data: Partial<Pick<HostelBedEntity, 'isAvailable'>>,
  ): Promise<HostelBedEntity | null>;

  createMessPlan(data: NewMessPlan): Promise<MessPlanEntity>;
  listMessPlans(tenantId: string, hostelId?: string): Promise<MessPlanEntity[]>;
  findMessPlanById(id: string, tenantId: string): Promise<MessPlanEntity | null>;
  createMessMenuItem(data: NewMessMenuItem): Promise<MessMenuItemEntity>;
  listMessMenuItems(tenantId: string, planId: string): Promise<MessMenuItemEntity[]>;
  createMessSubscription(data: NewMessSubscription): Promise<MessSubscriptionEntity>;
  listMessSubscriptions(tenantId: string, planId?: string): Promise<MessSubscriptionEntity[]>;

  createGatePass(data: NewGatePass): Promise<GatePassEntity>;
  listGatePasses(tenantId: string, hostelId?: string): Promise<GatePassEntity[]>;
  findGatePassById(id: string, tenantId: string): Promise<GatePassEntity | null>;
  updateGatePass(
    id: string,
    tenantId: string,
    data: Partial<Pick<GatePassEntity, 'status' | 'decidedBy' | 'outAt' | 'inAt'>>,
  ): Promise<GatePassEntity | null>;

  createFeeStructure(data: NewHostelFeeStructure): Promise<HostelFeeStructureEntity>;
  listFeeStructures(tenantId: string, hostelId?: string): Promise<HostelFeeStructureEntity[]>;

  upsertAttendance(data: NewHostelAttendance): Promise<HostelAttendanceEntity>;
  listAttendance(
    tenantId: string,
    blockId: string,
    onDate: string,
  ): Promise<HostelAttendanceEntity[]>;
}
