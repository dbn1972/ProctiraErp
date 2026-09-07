/**
 * Hostel service — occupancy shell operations.
 */
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { HostelRepository, LeaveStatus } from './hostel-repository.js';
import type {
  CreateAssignmentInput,
  CreateBedInput,
  CreateBlockInput,
  CreateHostelInput,
  CreateLeaveInput,
  CreateRoomInput,
  CreateVisitorInput,
} from './schemas.js';

export class HostelService {
  constructor(private readonly repository: HostelRepository) {}

  async createHostel(tenantId: string, input: CreateHostelInput) {
    return this.repository.createHostel({
      id: uuidv4(),
      tenantId,
      name: input.name,
      code: input.code,
      address: input.address ?? null,
      capacity: input.capacity ?? 0,
      status: 'active',
    });
  }

  async listHostels(tenantId: string) {
    return this.repository.listHostels(tenantId);
  }

  async getHostel(tenantId: string, id: string) {
    const hostel = await this.repository.findHostelById(id, tenantId);
    if (!hostel) {
      throw new NotFoundError(`Hostel with id '${id}' not found`);
    }
    return hostel;
  }

  async createAssignment(tenantId: string, input: CreateAssignmentInput) {
    const bed = await this.repository.findBedById(input.bedId, tenantId);
    if (!bed) {
      throw new NotFoundError(`Bed with id '${input.bedId}' not found`);
    }
    if (!bed.isAvailable && (input.isActive ?? true)) {
      throw new ConflictError('Bed is not available for assignment');
    }

    const assignment = await this.repository.createAssignment({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      bedId: input.bedId,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      isActive: input.isActive ?? true,
    });

    if (assignment.isActive) {
      await this.repository.updateBed(input.bedId, tenantId, { isAvailable: false });
    }

    return assignment;
  }

  async listAssignments(tenantId: string) {
    return this.repository.listAssignments(tenantId);
  }

  async createLeave(tenantId: string, input: CreateLeaveInput) {
    return this.repository.createLeave({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      hostelId: input.hostelId,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason ?? null,
      status: 'pending',
    });
  }

  async listLeaves(tenantId: string) {
    return this.repository.listLeaves(tenantId);
  }

  async decideLeave(tenantId: string, leaveId: string, status: 'approved' | 'rejected') {
    const leave = await this.repository.findLeaveById(leaveId, tenantId);
    if (!leave) {
      throw new NotFoundError(`Leave with id '${leaveId}' not found`);
    }
    if (leave.status !== 'pending') {
      throw new ConflictError(`Leave is already ${leave.status}`);
    }
    if (status !== 'approved' && status !== 'rejected') {
      throw new BusinessRuleError('Leave decision must be approved or rejected');
    }
    const updated = await this.repository.updateLeave(leaveId, tenantId, {
      status: status as LeaveStatus,
    });
    return updated!;
  }

  async createVisitor(tenantId: string, input: CreateVisitorInput) {
    return this.repository.createVisitor({
      id: uuidv4(),
      tenantId,
      hostelId: input.hostelId,
      visitorName: input.visitorName,
      studentId: input.studentId,
      visitDate: input.visitDate,
      status: 'expected',
    });
  }

  async listVisitors(tenantId: string) {
    return this.repository.listVisitors(tenantId);
  }

  async createBlock(tenantId: string, input: CreateBlockInput) {
    return this.repository.createBlock({
      id: uuidv4(),
      tenantId,
      hostelId: input.hostelId,
      name: input.name,
      floor: input.floor ?? 0,
    });
  }

  async listBlocks(tenantId: string, hostelId?: string) {
    return this.repository.listBlocks(tenantId, hostelId);
  }

  async createRoom(tenantId: string, input: CreateRoomInput) {
    return this.repository.createRoom({
      id: uuidv4(),
      tenantId,
      blockId: input.blockId,
      roomNumber: input.roomNumber,
      capacity: input.capacity ?? 1,
    });
  }

  async listRooms(tenantId: string, blockId?: string) {
    return this.repository.listRooms(tenantId, blockId);
  }

  async createBed(tenantId: string, input: CreateBedInput) {
    return this.repository.createBed({
      id: uuidv4(),
      tenantId,
      roomId: input.roomId,
      bedLabel: input.bedLabel,
      isAvailable: input.isAvailable ?? true,
    });
  }

  async listBeds(tenantId: string, roomId?: string) {
    return this.repository.listBeds(tenantId, roomId);
  }
}
