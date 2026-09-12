/**
 * Hostel service — occupancy shell operations.
 */
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { HostelFeesPort } from './fees-ledger-port.js';
import { canTransitionGatePass, isOverdueReturn } from './hostel-ops.js';
import {
  BedAssignmentConflictError,
  type GatePassStatus,
  type HostelAttendanceStatus,
  type HostelRepository,
  type LeaveStatus,
  type VisitorStatus,
} from './hostel-repository.js';
import type {
  CreateAssignmentInput,
  CreateAttendanceInput,
  CreateBedInput,
  CreateBlockInput,
  CreateFeeStructureInput,
  CreateGatePassInput,
  CreateHostelInput,
  CreateLeaveInput,
  CreateMessMenuItemInput,
  CreateMessPlanInput,
  CreateMessSubscriptionInput,
  CreateRoomInput,
  CreateVisitorInput,
} from './schemas.js';

export class HostelService {
  constructor(
    private readonly repository: HostelRepository,
    private readonly feesLedger: HostelFeesPort | null = null,
  ) {}

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

  async createAssignment(
    tenantId: string,
    input: CreateAssignmentInput,
    actorId = 'hostel-system',
  ) {
    const isActive = input.isActive ?? true;
    const bed = await this.repository.findBedById(input.bedId, tenantId);
    if (!bed) {
      throw new NotFoundError(`Bed with id '${input.bedId}' not found`);
    }
    if (!bed.isAvailable && isActive) {
      throw new ConflictError('Bed is not available for assignment');
    }

    let invoice: Awaited<ReturnType<HostelFeesPort['postAllocationInvoice']>> | null = null;
    if (input.feeStructureId) {
      const structures = await this.repository.listFeeStructures(tenantId);
      const structure = structures.find((row) => row.id === input.feeStructureId);
      if (!structure) {
        throw new NotFoundError(`Hostel fee structure with id '${input.feeStructureId}' not found`);
      }
      if (this.feesLedger) {
        invoice = await this.feesLedger.postAllocationInvoice(tenantId, actorId, {
          studentId: input.studentId,
          title: `Hostel ${structure.roomType} — ${structure.termLabel}`,
          description: `Allocation fee for bed ${input.bedId}`,
          amountCents: structure.amountCents,
          currency: structure.currency,
          structureId: structure.id,
        });
      }
    }

    const payload = {
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      bedId: input.bedId,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      isActive,
    };

    try {
      if (isActive) {
        // P2-HOSTEL: unique-active-bed + concurrency guard (FOR UPDATE / sync claim).
        const assignment = await this.repository.createActiveAssignment({
          ...payload,
          isActive: true,
        });
        return { ...assignment, invoice };
      }
      const assignment = await this.repository.createAssignment(payload);
      return { ...assignment, invoice };
    } catch (err) {
      if (err instanceof BedAssignmentConflictError) {
        throw new ConflictError(err.message);
      }
      throw err;
    }
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

  async updateVisitorStatus(tenantId: string, visitorId: string, status: VisitorStatus) {
    const visitor = await this.repository.findVisitorById(visitorId, tenantId);
    if (!visitor) {
      throw new NotFoundError(`Visitor with id '${visitorId}' not found`);
    }

    const allowed: Record<VisitorStatus, VisitorStatus[]> = {
      expected: ['checked_in', 'denied'],
      checked_in: ['checked_out'],
      checked_out: [],
      denied: [],
    };

    if (!allowed[visitor.status].includes(status)) {
      throw new ConflictError(`Cannot transition visitor from ${visitor.status} to ${status}`);
    }

    const updated = await this.repository.updateVisitor(visitorId, tenantId, { status });
    return updated!;
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

  async createMessPlan(tenantId: string, input: CreateMessPlanInput) {
    const hostel = await this.repository.findHostelById(input.hostelId, tenantId);
    if (!hostel) {
      throw new NotFoundError(`Hostel with id '${input.hostelId}' not found`);
    }
    return this.repository.createMessPlan({
      id: uuidv4(),
      tenantId,
      hostelId: input.hostelId,
      name: input.name,
      mealCount: input.mealCount ?? 3,
      status: 'active',
    });
  }

  async listMessPlans(tenantId: string, hostelId?: string) {
    return this.repository.listMessPlans(tenantId, hostelId);
  }

  async addMessMenuItem(tenantId: string, input: CreateMessMenuItemInput) {
    const plan = await this.repository.findMessPlanById(input.planId, tenantId);
    if (!plan) {
      throw new NotFoundError(`Mess plan with id '${input.planId}' not found`);
    }
    return this.repository.createMessMenuItem({
      id: uuidv4(),
      tenantId,
      planId: input.planId,
      weekday: input.weekday,
      meal: input.meal,
      itemName: input.itemName,
    });
  }

  async listMessMenu(tenantId: string, planId: string) {
    return this.repository.listMessMenuItems(tenantId, planId);
  }

  async subscribeMess(tenantId: string, input: CreateMessSubscriptionInput) {
    const plan = await this.repository.findMessPlanById(input.planId, tenantId);
    if (!plan) {
      throw new NotFoundError(`Mess plan with id '${input.planId}' not found`);
    }
    return this.repository.createMessSubscription({
      id: uuidv4(),
      tenantId,
      planId: input.planId,
      studentId: input.studentId,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      status: 'active',
    });
  }

  async listMessSubscriptions(tenantId: string, planId?: string) {
    return this.repository.listMessSubscriptions(tenantId, planId);
  }

  async requestGatePass(tenantId: string, input: CreateGatePassInput) {
    const hostel = await this.repository.findHostelById(input.hostelId, tenantId);
    if (!hostel) {
      throw new NotFoundError(`Hostel with id '${input.hostelId}' not found`);
    }
    const expectedOutAt = new Date(input.expectedOutAt);
    const expectedInAt = new Date(input.expectedInAt);
    if (Number.isNaN(expectedOutAt.getTime()) || Number.isNaN(expectedInAt.getTime())) {
      throw new BusinessRuleError('expectedOutAt and expectedInAt must be valid timestamps');
    }
    if (expectedInAt.getTime() < expectedOutAt.getTime()) {
      throw new BusinessRuleError('expectedInAt must be on or after expectedOutAt');
    }
    return this.repository.createGatePass({
      id: uuidv4(),
      tenantId,
      hostelId: input.hostelId,
      studentId: input.studentId,
      requestedBy: input.requestedBy ?? 'resident',
      requesterUserId: input.requesterUserId ?? null,
      reason: input.reason ?? null,
      expectedOutAt,
      expectedInAt,
      status: 'pending',
      decidedBy: null,
      outAt: null,
      inAt: null,
    });
  }

  async listGatePasses(tenantId: string, hostelId?: string, now: Date = new Date()) {
    const rows = await this.repository.listGatePasses(tenantId, hostelId);
    return rows.map((row) => ({
      ...row,
      overdueReturn: isOverdueReturn(row.status, row.expectedInAt, now),
    }));
  }

  async transitionGatePass(tenantId: string, id: string, next: GatePassStatus, actorId?: string) {
    const pass = await this.repository.findGatePassById(id, tenantId);
    if (!pass) {
      throw new NotFoundError(`Gate pass with id '${id}' not found`);
    }
    if (!canTransitionGatePass(pass.status, next)) {
      throw new ConflictError(`Cannot transition gate pass from ${pass.status} to ${next}`);
    }
    const patch: Partial<Pick<typeof pass, 'status' | 'decidedBy' | 'outAt' | 'inAt'>> = {
      status: next,
    };
    if (next === 'approved' || next === 'rejected') {
      patch.decidedBy = actorId ?? null;
    }
    if (next === 'out') {
      patch.outAt = new Date();
    }
    if (next === 'in') {
      patch.inAt = new Date();
    }
    const updated = await this.repository.updateGatePass(id, tenantId, patch);
    return {
      ...updated!,
      overdueReturn: isOverdueReturn(
        updated!.status,
        updated!.expectedInAt,
        updated!.inAt ?? new Date(),
      ),
    };
  }

  async createFeeStructure(tenantId: string, input: CreateFeeStructureInput) {
    const hostel = await this.repository.findHostelById(input.hostelId, tenantId);
    if (!hostel) {
      throw new NotFoundError(`Hostel with id '${input.hostelId}' not found`);
    }
    return this.repository.createFeeStructure({
      id: uuidv4(),
      tenantId,
      hostelId: input.hostelId,
      roomType: input.roomType,
      termLabel: input.termLabel,
      amountCents: input.amountCents,
      currency: input.currency ?? 'INR',
    });
  }

  async listFeeStructures(tenantId: string, hostelId?: string) {
    return this.repository.listFeeStructures(tenantId, hostelId);
  }

  async summarizeFeeStructures(tenantId: string, hostelId?: string) {
    const structures = await this.repository.listFeeStructures(tenantId, hostelId);
    return {
      hostelId: hostelId ?? null,
      count: structures.length,
      totalAmountCents: structures.reduce((sum, row) => sum + row.amountCents, 0),
      currency: structures[0]?.currency ?? 'INR',
      structures,
    };
  }

  async upsertAttendance(tenantId: string, input: CreateAttendanceInput) {
    const blocks = await this.repository.listBlocks(tenantId);
    const block = blocks.find((b) => b.id === input.blockId);
    if (!block) {
      throw new NotFoundError(`Block with id '${input.blockId}' not found`);
    }
    return this.repository.upsertAttendance({
      id: uuidv4(),
      tenantId,
      blockId: input.blockId,
      studentId: input.studentId,
      onDate: input.onDate,
      status: input.status as HostelAttendanceStatus,
      reason: input.reason ?? null,
    });
  }

  async listAttendance(tenantId: string, blockId: string, onDate: string) {
    return this.repository.listAttendance(tenantId, blockId, onDate);
  }
}
