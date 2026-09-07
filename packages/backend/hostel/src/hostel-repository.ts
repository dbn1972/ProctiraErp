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

export interface HostelRepository {
  createHostel(data: Omit<HostelEntity, 'createdAt' | 'updatedAt'>): Promise<HostelEntity>;
  listHostels(tenantId: string): Promise<HostelEntity[]>;
  findHostelById(id: string, tenantId: string): Promise<HostelEntity | null>;

  createAssignment(
    data: Omit<HostelAssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<HostelAssignmentEntity>;
  listAssignments(tenantId: string): Promise<HostelAssignmentEntity[]>;
  listLeaves(tenantId: string): Promise<HostelLeaveEntity[]>;
  listVisitors(tenantId: string): Promise<HostelVisitorEntity[]>;
}
