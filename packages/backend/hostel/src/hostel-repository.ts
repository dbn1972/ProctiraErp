/** Hostel repository ports (P21). */

export interface HostelEntity {
  id: string;
  tenantId: string;
  institutionId: string;
  name: string;
  gender: string;
  capacity: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface HostelRoomEntity {
  id: string;
  tenantId: string;
  hostelId: string;
  name: string;
  beds: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface HostelAllocationEntity {
  id: string;
  tenantId: string;
  hostelId: string;
  roomId: string;
  studentId: string;
  startDate: string;
  endDate: string | null;
  feeInvoiceId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface HostelRepository {
  listHostels(tenantId: string): Promise<HostelEntity[]>;
  getHostel(tenantId: string, id: string): Promise<HostelEntity | null>;
  createHostel(row: HostelEntity): Promise<HostelEntity>;
  updateHostel(tenantId: string, id: string, patch: Partial<HostelEntity>): Promise<HostelEntity | null>;
  listHostelRooms(tenantId: string): Promise<HostelRoomEntity[]>;
  getHostelRoom(tenantId: string, id: string): Promise<HostelRoomEntity | null>;
  createHostelRoom(row: HostelRoomEntity): Promise<HostelRoomEntity>;
  updateHostelRoom(tenantId: string, id: string, patch: Partial<HostelRoomEntity>): Promise<HostelRoomEntity | null>;
  listHostelAllocations(tenantId: string): Promise<HostelAllocationEntity[]>;
  getHostelAllocation(tenantId: string, id: string): Promise<HostelAllocationEntity | null>;
  createHostelAllocation(row: HostelAllocationEntity): Promise<HostelAllocationEntity>;
  updateHostelAllocation(tenantId: string, id: string, patch: Partial<HostelAllocationEntity>): Promise<HostelAllocationEntity | null>;
}
