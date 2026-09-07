/**
 * Staff HR leave service — create, list, approve/reject.
 */
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { StaffLeaveRepository, StaffLeaveStatus } from './leave-repository.js';
import type { CreateStaffLeaveInput, DecideStaffLeaveInput } from './leave-schemas.js';

export class StaffLeaveService {
  constructor(private readonly repository: StaffLeaveRepository) {}

  async createLeave(tenantId: string, input: CreateStaffLeaveInput) {
    if (input.endDate < input.startDate) {
      throw new BusinessRuleError('End date must be on or after start date');
    }
    return this.repository.createLeave({
      id: uuidv4(),
      tenantId,
      staffId: input.staffId,
      leaveType: input.leaveType ?? 'annual',
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason ?? null,
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
    });
  }

  async listLeaves(tenantId: string) {
    return this.repository.listLeaves(tenantId);
  }

  async decideLeave(
    tenantId: string,
    leaveId: string,
    input: DecideStaffLeaveInput,
    actorId: string,
  ) {
    const leave = await this.repository.findLeaveById(leaveId, tenantId);
    if (!leave) {
      throw new NotFoundError(`Leave with id '${leaveId}' not found`);
    }
    if (leave.status !== 'pending') {
      throw new ConflictError(`Leave is already ${leave.status}`);
    }
    const status = input.status as StaffLeaveStatus;
    const updated = await this.repository.updateLeave(leaveId, tenantId, {
      status,
      decidedBy: actorId,
      decidedAt: new Date(),
    });
    return updated!;
  }
}
