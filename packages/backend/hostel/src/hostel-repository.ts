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
}
