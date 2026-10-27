/**
 * Hostel service — occupancy shell operations.
 */
import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import type { PaginationOptions } from '@proctira/common';
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

/**
 * PRC-L317: one domain audit event for a hostel mutation (bed assignment, leave decision,
 * gate pass, visitor check-in/out, fee structure).
 */
export interface HostelAuditEntry {
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

/**
 * PRC-L317: durable writer for hostel audit events, wired by the gateway to the shared
 * hash-chained audit log. Awaited after the mutation so a failed write surfaces as an error.
 */
export type HostelAuditSink = (entry: HostelAuditEntry) => Promise<void>;

export interface HostelServiceOptions {
  auditSink?: HostelAuditSink | null;
}

export class HostelService {
  constructor(
    private readonly repository: HostelRepository,
    private readonly feesLedger: HostelFeesPort | null = null,
    private readonly options: HostelServiceOptions = {},
  ) {}

  /** PRC-L317: no sink configured means no behaviour change. */
  private async audit(entry: HostelAuditEntry): Promise<void> {
    if (this.options.auditSink) await this.options.auditSink(entry);
  }

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

    // Resolve the fee structure up front (cheap read, no side effects) so an
    // invalid structure fails before we claim the bed.
    let structure: Awaited<ReturnType<HostelRepository['listFeeStructures']>>[number] | undefined;
    if (input.feeStructureId) {
      const structures = await this.repository.listFeeStructures(tenantId);
      structure = structures.find((row) => row.id === input.feeStructureId);
      if (!structure) {
        throw new NotFoundError(`Hostel fee structure with id '${input.feeStructureId}' not found`);
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

    // PRC-M276 / NEW-005: claim the bed FIRST. The previous order posted the fee
    // invoice before createActiveAssignment, so a BedAssignmentConflictError left
    // an orphan posted invoice (money owed for a bed that was never allocated).
    let assignment: Awaited<ReturnType<HostelRepository['createActiveAssignment']>>;
    try {
      if (isActive) {
        // P2-HOSTEL: unique-active-bed + concurrency guard (FOR UPDATE / sync claim).
        assignment = await this.repository.createActiveAssignment({
          ...payload,
          isActive: true,
        });
      } else {
        assignment = await this.repository.createAssignment(payload);
      }
    } catch (err) {
      if (err instanceof BedAssignmentConflictError) {
        throw new ConflictError(err.message);
      }
      throw err;
    }

    // Bed is claimed; now post the allocation invoice. If invoicing fails we
    // surface the error (the caller sees a failure) but no invoice is orphaned.
    let invoice: Awaited<ReturnType<HostelFeesPort['postAllocationInvoice']>> | null = null;
    if (structure && this.feesLedger) {
      invoice = await this.feesLedger.postAllocationInvoice(tenantId, actorId, {
        studentId: input.studentId,
        title: `Hostel ${structure.roomType} — ${structure.termLabel}`,
        description: `Allocation fee for bed ${input.bedId}`,
        amountCents: structure.amountCents,
        currency: structure.currency,
        structureId: structure.id,
      });
    }

    await this.audit({
      tenantId,
      action: 'bed_assignment.create',
      entityType: 'hostel_bed_assignment',
      entityId: assignment.id,
      actorId,
      operation: 'CREATE',
      before: null,
      after: {
        studentId: assignment.studentId,
        bedId: assignment.bedId,
        startDate: assignment.startDate,
        endDate: assignment.endDate,
        isActive: assignment.isActive,
      },
      metadata: { feeStructureId: structure?.id ?? null, invoiceId: invoice?.id ?? null },
    });
    return { ...assignment, invoice };
  }

  async listAssignments(tenantId: string, pagination: PaginationOptions) {
    return this.repository.listAssignments(tenantId, pagination);
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

  async listLeaves(tenantId: string, pagination: PaginationOptions) {
    return this.repository.listLeaves(tenantId, pagination);
  }

  async decideLeave(
    tenantId: string,
    leaveId: string,
    status: 'approved' | 'rejected',
    actorId: string | null = null,
  ) {
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
    const updated = await this.repository.updateLeave(
      leaveId,
      tenantId,
      { status: status as LeaveStatus },
      leave.status,
    );
    if (!updated) {
      // PRC-L116: lost the compare-and-set to a concurrent decision.
      const current = await this.repository.findLeaveById(leaveId, tenantId);
      if (!current) throw new NotFoundError(`Leave with id '${leaveId}' not found`);
      throw new ConflictError(`Leave is already ${current.status}`);
    }
    await this.audit({
      tenantId,
      action: 'leave.decide',
      entityType: 'hostel_leave',
      entityId: leaveId,
      actorId,
      operation: 'UPDATE',
      before: { status: leave.status },
      after: { status: updated.status },
      metadata: { studentId: leave.studentId, hostelId: leave.hostelId },
    });
    return updated;
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

  async listVisitors(tenantId: string, pagination: PaginationOptions) {
    return this.repository.listVisitors(tenantId, pagination);
  }

  async updateVisitorStatus(
    tenantId: string,
    visitorId: string,
    status: VisitorStatus,
    actorId: string | null = null,
  ) {
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

    const updated = await this.repository.updateVisitor(
      visitorId,
      tenantId,
      { status },
      visitor.status,
    );
    if (!updated) {
      // PRC-L116: lost the compare-and-set to a concurrent transition.
      const current = await this.repository.findVisitorById(visitorId, tenantId);
      if (!current) throw new NotFoundError(`Visitor with id '${visitorId}' not found`);
      throw new ConflictError(`Cannot transition visitor from ${current.status} to ${status}`);
    }
    await this.audit({
      tenantId,
      action: 'visitor.status',
      entityType: 'hostel_visitor',
      entityId: visitorId,
      actorId,
      operation: 'UPDATE',
      before: { status: visitor.status },
      after: { status: updated.status },
      metadata: { studentId: visitor.studentId, hostelId: visitor.hostelId },
    });
    return updated;
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

  async requestGatePass(
    tenantId: string,
    input: CreateGatePassInput,
    actorId: string | null = null,
  ) {
    const hostel = await this.repository.findHostelById(input.hostelId, tenantId);
    if (!hostel) {
      throw new NotFoundError(`Hostel with id '${input.hostelId}' not found`);
    }
    const expectedOutAt = new Date(input.expectedOutAt);
    const expectedInAt = new Date(input.expectedInAt);
    if (Number.isNaN(expectedOutAt.getTime()) || Number.isNaN(expectedInAt.getTime())) {
      throw new BusinessRuleError('expectedOutAt and expectedInAt must be valid timestamps');
    }
    // PRC-M478: the return must be strictly after the departure.
    if (expectedInAt.getTime() <= expectedOutAt.getTime()) {
      throw new BusinessRuleError('expectedInAt must be after expectedOutAt');
    }
    const pass = await this.repository.createGatePass({
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
    await this.audit({
      tenantId,
      action: 'gate_pass.request',
      entityType: 'hostel_gate_pass',
      entityId: pass.id,
      actorId,
      operation: 'CREATE',
      before: null,
      after: {
        status: pass.status,
        studentId: pass.studentId,
        expectedOutAt: pass.expectedOutAt.toISOString(),
        expectedInAt: pass.expectedInAt.toISOString(),
      },
      metadata: { hostelId: pass.hostelId },
    });
    return pass;
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
    const updated = await this.repository.updateGatePass(id, tenantId, patch, pass.status);
    if (!updated) {
      // PRC-L116: lost the compare-and-set to a concurrent transition.
      const current = await this.repository.findGatePassById(id, tenantId);
      if (!current) throw new NotFoundError(`Gate pass with id '${id}' not found`);
      throw new ConflictError(`Cannot transition gate pass from ${current.status} to ${next}`);
    }
    await this.audit({
      tenantId,
      action: 'gate_pass.transition',
      entityType: 'hostel_gate_pass',
      entityId: id,
      actorId: actorId ?? null,
      operation: 'UPDATE',
      before: { status: pass.status },
      after: { status: updated.status },
      metadata: { studentId: pass.studentId, hostelId: pass.hostelId },
    });
    return {
      ...updated,
      overdueReturn: isOverdueReturn(
        updated.status,
        updated.expectedInAt,
        updated.inAt ?? new Date(),
      ),
    };
  }

  async createFeeStructure(
    tenantId: string,
    input: CreateFeeStructureInput,
    actorId: string | null = null,
  ) {
    const hostel = await this.repository.findHostelById(input.hostelId, tenantId);
    if (!hostel) {
      throw new NotFoundError(`Hostel with id '${input.hostelId}' not found`);
    }
    const row = await this.repository.createFeeStructure({
      id: uuidv4(),
      tenantId,
      hostelId: input.hostelId,
      roomType: input.roomType,
      termLabel: input.termLabel,
      amountCents: input.amountCents,
      currency: input.currency ?? 'INR',
    });
    await this.audit({
      tenantId,
      action: 'fee_structure.create',
      entityType: 'hostel_fee_structure',
      entityId: row.id,
      actorId,
      operation: 'CREATE',
      before: null,
      after: {
        hostelId: row.hostelId,
        roomType: row.roomType,
        termLabel: row.termLabel,
        amountCents: row.amountCents,
        currency: row.currency,
      },
    });
    return row;
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
