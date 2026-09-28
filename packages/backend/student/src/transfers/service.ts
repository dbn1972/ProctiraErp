import { BusinessRuleError, NotFoundError, ValidationError } from '@proctira/common';

import { convertMarks } from './marks.js';
import type { MemoryTransferWorkflowStore } from './memory-store.js';
import type { PgTransferWorkflowStore } from './pg-store.js';
import {
  assertCanDecide,
  assertCanEditEquivalency,
  assertCanRead,
  nextStatus,
  schoolInScope,
  type TransferActor,
  type TransferDecision,
  type TransferWorkflowStatus,
} from './state-machine.js';
import type {
  CreateTransferInput,
  EquivalencyInput,
  GradeEquivalencyRule,
  TransferApprovalEvent,
  TransferWorkflowRow,
} from './types.js';

export type TransferWorkflowStore = MemoryTransferWorkflowStore | PgTransferWorkflowStore;

const HAPPY_PATH: TransferWorkflowStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'COMPLETED',
];

export class TransferWorkflowService {
  constructor(private readonly store: TransferWorkflowStore) {}

  async create(tenantId: string, actor: TransferActor, input: CreateTransferInput) {
    assertCanDecide(actor, 'SUBMIT', input.sourceInstitutionId, input.destinationInstitutionId);
    if (input.sourceInstitutionId === input.destinationInstitutionId) {
      throw new BusinessRuleError('Source and destination institutions must differ');
    }
    const row = await this.store.create(tenantId, actor, input);
    return this.toDashboard(tenantId, row, actor);
  }

  async getDashboard(tenantId: string, transferId: string, actor: TransferActor) {
    assertCanRead(actor);
    const row = await this.requireRow(tenantId, transferId);
    return this.toDashboard(tenantId, row, actor);
  }

  async listPending(tenantId: string, actor: TransferActor) {
    assertCanRead(actor);
    const rows = await this.store.listOpen(tenantId);
    return {
      data: rows
        .filter((row) => this.visibleTo(actor, row))
        .map((row) => ({
          id: row.id,
          studentId: row.studentId,
          studentName: row.studentName,
          sourceInstitutionId: row.sourceInstitutionId,
          sourceInstitutionName: row.sourceInstitutionName,
          destinationInstitutionId: row.destinationInstitutionId,
          destinationInstitutionName: row.destinationInstitutionName,
          sourceBoard: row.sourceBoardName,
          destinationBoard: row.destinationBoardName,
          status: row.status,
          reason: row.reason,
          requestedAt: row.createdAt,
        })),
    };
  }

  async decide(
    tenantId: string,
    transferId: string,
    actor: TransferActor,
    decision: TransferDecision,
    comment?: string,
  ) {
    const row = await this.requireRow(tenantId, transferId);
    const next = nextStatus(row.status, decision);
    assertCanDecide(actor, decision, row.sourceInstitutionId, row.destinationInstitutionId);
    const trimmed = comment?.trim() ?? '';
    if ((decision === 'REJECT' || decision === 'CANCEL') && trimmed.length === 0) {
      throw new ValidationError('A comment is required');
    }
    if (decision === 'APPROVE') {
      await this.assertEquivalency(tenantId, row);
    }
    const updated = await this.store.apply({
      tenantId,
      transferId,
      expected: row.status,
      next,
      decision,
      actor,
      comment: trimmed.length > 0 ? trimmed : null,
    });
    return this.toDashboard(tenantId, updated, actor);
  }

  async listEquivalency(
    tenantId: string,
    actor: TransferActor,
    filter?: { sourceBoardId?: string; targetBoardId?: string; gradeCode?: string },
  ) {
    assertCanRead(actor);
    const data = await this.store.listEquivalency(tenantId, filter);
    return { data: data.map((rule) => this.equivalencyJson(rule)) };
  }

  async createEquivalency(tenantId: string, actor: TransferActor, input: EquivalencyInput) {
    assertCanEditEquivalency(actor);
    this.assertScales(input);
    const rule = await this.store.upsertEquivalency(tenantId, input);
    return this.equivalencyJson(rule);
  }

  async updateEquivalency(
    tenantId: string,
    actor: TransferActor,
    id: string,
    input: EquivalencyInput,
  ) {
    assertCanEditEquivalency(actor);
    this.assertScales(input);
    const rule = await this.store.upsertEquivalency(tenantId, input, id);
    return this.equivalencyJson(rule);
  }

  async deleteEquivalency(tenantId: string, actor: TransferActor, id: string) {
    assertCanEditEquivalency(actor);
    const removed = await this.store.deleteEquivalency(tenantId, id);
    if (!removed) throw new NotFoundError('Equivalency rule not found');
    return { deleted: true };
  }

  previewMarks(input: {
    sourceMarks: number;
    sourceMax: number;
    targetMax: number;
    creditFactor: number;
  }): number {
    return convertMarks(input);
  }

  private async requireRow(tenantId: string, transferId: string): Promise<TransferWorkflowRow> {
    const row = await this.store.get(tenantId, transferId);
    if (!row) throw new NotFoundError(`Transfer with id '${transferId}' not found`);
    return row;
  }

  private async assertEquivalency(tenantId: string, row: TransferWorkflowRow): Promise<void> {
    if (!row.sourceBoardId || !row.destinationBoardId) return;
    if (row.sourceBoardId === row.destinationBoardId) return;
    const rules = await this.store.listEquivalency(tenantId, {
      sourceBoardId: row.sourceBoardId,
      targetBoardId: row.destinationBoardId,
    });
    const usable = rules.some(
      (rule) => rule.mappingStatus === 'mapped' || rule.mappingStatus === 'bridge',
    );
    if (!usable) {
      throw new BusinessRuleError(
        'Cross-board approval needs at least one mapped or bridge grade equivalency rule',
      );
    }
  }

  private assertScales(input: EquivalencyInput): void {
    if (!(input.sourceMarksMax > 0) || !(input.targetMarksMax > 0) || input.creditFactor < 0) {
      throw new ValidationError('Marks scales must be positive');
    }
  }

  private visibleTo(actor: TransferActor, row: TransferWorkflowRow): boolean {
    const source = schoolInScope(actor, row.sourceInstitutionId);
    const dest = schoolInScope(actor, row.destinationInstitutionId);
    if (!source && !dest) return false;
    if (
      actor.roleIds.includes('registrar') &&
      !actor.roleIds.some((role) => role !== 'registrar')
    ) {
      return source && (row.status === 'DRAFT' || row.status === 'SUBMITTED');
    }
    return true;
  }

  private async toDashboard(tenantId: string, row: TransferWorkflowRow, actor: TransferActor) {
    const events = await this.store.events(tenantId, row.id);
    const rules =
      row.sourceBoardId && row.destinationBoardId
        ? await this.store.listEquivalency(tenantId, {
            sourceBoardId: row.sourceBoardId,
            targetBoardId: row.destinationBoardId,
          })
        : [];
    const capabilities = this.capabilities(actor, row);
    const activeStep = this.activeStep(row.status);
    return {
      transferId: row.id,
      studentId: row.studentId,
      studentName: row.studentName?.trim() || 'Student',
      transferType: this.transferType(row),
      reason: row.reason,
      requestedAt: row.createdAt,
      workflowStatus: row.status,
      source: {
        id: row.sourceInstitutionId,
        name: row.sourceInstitutionName?.trim() || 'Source institution',
        board: row.sourceBoardName?.trim() || row.sourceBoardCode || 'Board not recorded',
      },
      destination: {
        id: row.destinationInstitutionId,
        name: row.destinationInstitutionName?.trim() || 'Destination institution',
        board: row.destinationBoardName?.trim() || row.destinationBoardCode || 'Board not recorded',
      },
      states: this.statesFor(row.status),
      currentStateId: this.uiState(row.status),
      completedStateIds: this.completedStates(row.status),
      approvals: this.approvalSteps(row, events),
      equivalency: rules.map((rule) => ({
        id: rule.id,
        sourceSubject: `${rule.sourceGradeCode} ${rule.sourceSubject}`,
        destinationSubject: `${rule.targetGradeCode} ${rule.targetSubject}`,
        status: rule.mappingStatus,
        sourceMarksMax: rule.sourceMarksMax,
        targetMarksMax: rule.targetMarksMax,
        creditFactor: rule.creditFactor,
      })),
      documents: [],
      currentApprover: capabilities.canAct ? activeStep : undefined,
      capabilities,
      timeline: events.map((event) => ({
        id: event.id,
        at: event.createdAt,
        actorName: event.actorName,
        actorRole: event.actorRole,
        decision: event.decision,
        comment: event.comment,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
      })),
      destinationEnrollmentId: row.destinationEnrollmentId,
    };
  }

  private transferType(row: TransferWorkflowRow): string {
    if (row.sourceBoardCode && row.destinationBoardCode) {
      return row.sourceBoardCode === row.destinationBoardCode ? 'SAME_BOARD' : 'CROSS_BOARD';
    }
    if (row.sourceBoardName && row.destinationBoardName) {
      return row.sourceBoardName === row.destinationBoardName ? 'SAME_BOARD' : 'CROSS_BOARD';
    }
    return 'INSTITUTION_TRANSFER';
  }

  private uiState(status: TransferWorkflowStatus): string {
    return status.toLowerCase();
  }

  private statesFor(status: TransferWorkflowStatus) {
    if (status === 'REJECTED') {
      return [
        { id: 'draft', label: 'Draft' },
        { id: 'submitted', label: 'Submitted' },
        { id: 'under_review', label: 'Under review' },
        { id: 'rejected', label: 'Rejected' },
      ];
    }
    if (status === 'CANCELLED') {
      return [
        { id: 'draft', label: 'Draft' },
        { id: 'cancelled', label: 'Cancelled' },
      ];
    }
    return [
      { id: 'draft', label: 'Draft' },
      { id: 'submitted', label: 'Submitted' },
      { id: 'under_review', label: 'Under review' },
      { id: 'approved', label: 'Approved' },
      { id: 'completed', label: 'Completed' },
    ];
  }

  private completedStates(status: TransferWorkflowStatus): string[] {
    if (status === 'REJECTED') return ['draft', 'submitted', 'under_review'];
    if (status === 'CANCELLED') return ['draft'];
    const index = HAPPY_PATH.indexOf(status);
    if (index < 0) return [];
    return HAPPY_PATH.slice(0, index).map((item) => item.toLowerCase());
  }

  private activeStep(status: TransferWorkflowStatus): string | undefined {
    switch (status) {
      case 'DRAFT':
        return 'source_submit';
      case 'SUBMITTED':
        return 'dest_review';
      case 'UNDER_REVIEW':
        return 'dest_decision';
      case 'APPROVED':
        return 'complete_enrollment';
      default:
        return undefined;
    }
  }

  private capabilities(actor: TransferActor, row: TransferWorkflowRow) {
    const allow = (decision: TransferDecision): boolean => {
      try {
        nextStatus(row.status, decision);
        assertCanDecide(actor, decision, row.sourceInstitutionId, row.destinationInstitutionId);
        return true;
      } catch {
        return false;
      }
    };
    const canSubmit = allow('SUBMIT');
    const canStartReview = allow('START_REVIEW');
    const canApprove = allow('APPROVE');
    const canReject = allow('REJECT');
    const canCancel = allow('CANCEL');
    const canComplete = allow('COMPLETE');
    return {
      canSubmit,
      canStartReview,
      canApprove,
      canReject,
      canCancel,
      canComplete,
      canAct: canSubmit || canStartReview || canApprove || canReject || canComplete,
    };
  }

  private approvalSteps(row: TransferWorkflowRow, events: TransferApprovalEvent[]) {
    const note = (decision: string) =>
      events.filter((event) => event.decision === decision).at(-1)?.comment ?? undefined;
    const when = (decision: string) =>
      events.filter((event) => event.decision === decision).at(-1)?.createdAt;
    const order = ['source_submit', 'dest_review', 'dest_decision', 'complete_enrollment'] as const;
    const current = this.activeStep(row.status);
    const stepStatus = (id: (typeof order)[number]) => {
      if (row.status === 'COMPLETED') return 'completed' as const;
      if (row.status === 'REJECTED' && id === 'dest_decision') return 'rejected' as const;
      if (row.status === 'REJECTED') {
        return id === 'complete_enrollment' ? ('pending' as const) : ('completed' as const);
      }
      if (row.status === 'CANCELLED') return 'pending' as const;
      if (!current) return 'pending' as const;
      const idx = order.indexOf(id);
      const currentIdx = order.indexOf(current as (typeof order)[number]);
      if (idx < currentIdx) return 'completed' as const;
      if (idx === currentIdx) return 'current' as const;
      return 'pending' as const;
    };
    return [
      {
        id: 'source_submit',
        name: 'Requesting school',
        approver: 'Registrar or principal',
        status: stepStatus('source_submit'),
        updatedAt: when('SUBMIT'),
        note: note('SUBMIT'),
      },
      {
        id: 'dest_review',
        name: 'Receiving principal review',
        approver: 'Receiving principal',
        status: stepStatus('dest_review'),
        updatedAt: when('START_REVIEW'),
        note: note('START_REVIEW'),
      },
      {
        id: 'dest_decision',
        name: 'Receiving principal decision',
        approver: 'Receiving principal',
        status: stepStatus('dest_decision'),
        updatedAt: when('APPROVE') ?? when('REJECT'),
        note: note('APPROVE') ?? note('REJECT'),
      },
      {
        id: 'complete_enrollment',
        name: 'Enrollment move',
        approver: 'Receiving principal',
        status: stepStatus('complete_enrollment'),
        updatedAt: when('COMPLETE'),
        note: note('COMPLETE'),
      },
    ];
  }

  private equivalencyJson(rule: GradeEquivalencyRule) {
    return {
      id: rule.id,
      sourceBoardId: rule.sourceBoardId,
      sourceBoardCode: rule.sourceBoardCode,
      targetBoardId: rule.targetBoardId,
      targetBoardCode: rule.targetBoardCode,
      sourceGradeCode: rule.sourceGradeCode,
      targetGradeCode: rule.targetGradeCode,
      sourceSubject: rule.sourceSubject,
      targetSubject: rule.targetSubject,
      sourceMarksMax: rule.sourceMarksMax,
      targetMarksMax: rule.targetMarksMax,
      creditFactor: rule.creditFactor,
      mappingStatus: rule.mappingStatus,
      notes: rule.notes,
    };
  }
}
