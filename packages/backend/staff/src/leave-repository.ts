/**
 * Staff leave repository contract (HR leave v1).
 */
export type StaffLeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type StaffLeaveType = 'annual' | 'sick' | 'casual' | 'unpaid' | 'other';

export interface StaffLeaveEntity {
  id: string;
  tenantId: string;
  staffId: string;
  leaveType: StaffLeaveType;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: StaffLeaveStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StaffLeaveRepository {
  createLeave(data: Omit<StaffLeaveEntity, 'createdAt' | 'updatedAt'>): Promise<StaffLeaveEntity>;
  listLeaves(tenantId: string): Promise<StaffLeaveEntity[]>;
  findLeaveById(id: string, tenantId: string): Promise<StaffLeaveEntity | null>;
  updateLeave(
    id: string,
    tenantId: string,
    data: Partial<Pick<StaffLeaveEntity, 'status' | 'decidedBy' | 'decidedAt'>>,
  ): Promise<StaffLeaveEntity | null>;
}
