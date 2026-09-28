import { BusinessRuleError, ConflictError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { EnrollmentRepository } from '../enrollment/enrollment-repository.js';

import type { TransferActor, TransferDecision, TransferWorkflowStatus } from './state-machine.js';
import type {
  CreateTransferInput,
  EquivalencyInput,
  GradeEquivalencyRule,
  TransferApprovalEvent,
  TransferWorkflowRow,
} from './types.js';

interface MemoryEnrollment {
  id: string;
  tenantId: string;
  studentId: string;
  institutionId: string;
  status: 'ENROLLED' | 'TRANSFERRED';
}

/**
 * In-memory workflow store used when DATABASE_URL is unset (gateway unit tests).
 * Legacy rows created by the enrollment repository are still readable.
 */
export class MemoryTransferWorkflowStore {
  private readonly rows = new Map<string, TransferWorkflowRow>();
  private readonly eventLog = new Map<string, TransferApprovalEvent[]>();
  private readonly rules: GradeEquivalencyRule[] = [];
  private readonly enrollments = new Map<string, MemoryEnrollment>();

  constructor(private readonly enrollment?: EnrollmentRepository) {}

  async create(
    tenantId: string,
    actor: TransferActor,
    input: CreateTransferInput,
  ): Promise<TransferWorkflowRow> {
    const now = new Date().toISOString();
    const id = uuidv4();
    const row: TransferWorkflowRow = {
      id,
      tenantId,
      studentId: input.studentId,
      studentName: input.studentName ?? null,
      currentGradeName: null,
      sourceInstitutionId: input.sourceInstitutionId,
      sourceInstitutionName: input.sourceInstitutionName ?? null,
      sourceBoardId: input.sourceBoardId ?? null,
      sourceBoardName: input.sourceBoardCode ?? null,
      sourceBoardCode: input.sourceBoardCode ?? null,
      sourceEnrollmentId: input.sourceEnrollmentId,
      destinationInstitutionId: input.destinationInstitutionId,
      destinationInstitutionName: input.destinationInstitutionName ?? null,
      destinationBoardId: input.destinationBoardId ?? null,
      destinationBoardName: input.destinationBoardCode ?? null,
      destinationBoardCode: input.destinationBoardCode ?? null,
      destinationEnrollmentId: null,
      destinationGradeId: input.destinationGradeId,
      destinationClassId: input.destinationClassId,
      academicPeriodId: input.academicPeriodId,
      transferDate: input.transferDate,
      reason: input.reason,
      status: 'DRAFT',
      requestedBy: actor.userId,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(this.key(tenantId, id), row);
    this.enrollments.set(this.key(tenantId, input.sourceEnrollmentId), {
      id: input.sourceEnrollmentId,
      tenantId,
      studentId: input.studentId,
      institutionId: input.sourceInstitutionId,
      status: 'ENROLLED',
    });
    return row;
  }

  async get(tenantId: string, id: string): Promise<TransferWorkflowRow | null> {
    const hit = this.rows.get(this.key(tenantId, id));
    if (hit) return hit;
    if (!this.enrollment) return null;
    const legacy = await this.enrollment.getTransferById(tenantId, id);
    if (!legacy) return null;
    return {
      id: legacy.id,
      tenantId: legacy.tenantId,
      studentId: legacy.studentId,
      studentName: legacy.studentName,
      currentGradeName: null,
      sourceInstitutionId: legacy.sourceInstitutionId,
      sourceInstitutionName: legacy.sourceInstitutionName,
      sourceBoardId: null,
      sourceBoardName: legacy.sourceBoardName,
      sourceBoardCode: null,
      sourceEnrollmentId: legacy.sourceEnrollmentId,
      destinationInstitutionId: legacy.destinationInstitutionId,
      destinationInstitutionName: legacy.destinationInstitutionName,
      destinationBoardId: null,
      destinationBoardName: legacy.destinationBoardName,
      destinationBoardCode: null,
      destinationEnrollmentId: legacy.destinationEnrollmentId,
      destinationGradeId: '',
      destinationClassId: '',
      academicPeriodId: '',
      transferDate: legacy.transferDate.toISOString().slice(0, 10),
      reason: legacy.reason,
      status: 'COMPLETED',
      requestedBy: null,
      createdAt: legacy.createdAt.toISOString(),
      updatedAt: legacy.createdAt.toISOString(),
    };
  }

  async listFormOptions(_tenantId: string): Promise<{
    students: Array<{
      id: string;
      label: string;
      admissionNumber: string | null;
      enrollmentId: string;
      institutionId: string;
      institutionName: string;
      gradeId: string;
      gradeName: string;
    }>;
    institutions: Array<{
      id: string;
      name: string;
      boardId: string | null;
      boardName: string | null;
    }>;
    grades: Array<{ id: string; name: string; code: string }>;
    classes: Array<{ id: string; name: string; institutionId: string; gradeId: string }>;
    periods: Array<{ id: string; name: string }>;
    boards: Array<{ id: string; name: string; code: string }>;
    subjects: Array<{ id: string; name: string; code: string }>;
  }> {
    return {
      students: [],
      institutions: [],
      grades: [],
      classes: [],
      periods: [],
      boards: [],
      subjects: [],
    };
  }

  async listOpen(tenantId: string): Promise<TransferWorkflowRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async events(tenantId: string, transferId: string): Promise<TransferApprovalEvent[]> {
    return [...(this.eventLog.get(this.key(tenantId, transferId)) ?? [])];
  }

  async apply(input: {
    tenantId: string;
    transferId: string;
    expected: TransferWorkflowStatus;
    next: TransferWorkflowStatus;
    decision: TransferDecision;
    actor: TransferActor;
    comment: string | null;
  }): Promise<TransferWorkflowRow> {
    const row = this.rows.get(this.key(input.tenantId, input.transferId));
    if (!row || row.tenantId !== input.tenantId) {
      throw new ConflictError('Transfer changed before the decision was saved');
    }
    if (row.status === input.next) return row;
    if (row.status !== input.expected) {
      throw new ConflictError(`Cannot ${input.decision} a transfer that is ${row.status}`);
    }
    let destinationEnrollmentId = row.destinationEnrollmentId;
    if (input.next === 'COMPLETED') {
      destinationEnrollmentId = this.completeEnrollment(row);
    }
    const updated: TransferWorkflowRow = {
      ...row,
      status: input.next,
      destinationEnrollmentId,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(this.key(input.tenantId, input.transferId), updated);
    const event: TransferApprovalEvent = {
      id: uuidv4(),
      transferId: row.id,
      fromStatus: input.expected,
      toStatus: input.next,
      decision: input.decision,
      actorUserId: input.actor.userId,
      actorRole: input.actor.roleIds[0] ?? 'unknown',
      actorName: input.actor.displayName,
      comment: input.comment,
      createdAt: updated.updatedAt,
    };
    const list = this.eventLog.get(this.key(input.tenantId, input.transferId)) ?? [];
    list.push(event);
    this.eventLog.set(this.key(input.tenantId, input.transferId), list);
    return updated;
  }

  enrollmentStatus(tenantId: string, enrollmentId: string): string | null {
    return this.enrollments.get(this.key(tenantId, enrollmentId))?.status ?? null;
  }

  async listEquivalency(
    tenantId: string,
    filter?: { sourceBoardId?: string; targetBoardId?: string; gradeCode?: string },
  ): Promise<GradeEquivalencyRule[]> {
    return this.rules.filter((rule) => {
      if (rule.tenantId !== tenantId) return false;
      if (filter?.sourceBoardId && rule.sourceBoardId !== filter.sourceBoardId) return false;
      if (filter?.targetBoardId && rule.targetBoardId !== filter.targetBoardId) return false;
      if (filter?.gradeCode && rule.sourceGradeCode !== filter.gradeCode) return false;
      return true;
    });
  }

  async upsertEquivalency(
    tenantId: string,
    input: EquivalencyInput,
    id?: string,
  ): Promise<GradeEquivalencyRule> {
    const existing = id
      ? this.rules.find((rule) => rule.id === id && rule.tenantId === tenantId)
      : undefined;
    if (id && !existing) {
      throw new NotFoundError('Equivalency rule not found');
    }
    const rule: GradeEquivalencyRule = {
      id: existing?.id ?? uuidv4(),
      tenantId,
      sourceBoardId: input.sourceBoardId,
      sourceBoardCode: null,
      sourceBoardName: null,
      targetBoardId: input.targetBoardId,
      targetBoardCode: null,
      targetBoardName: null,
      sourceGradeCode: input.sourceGradeCode,
      targetGradeCode: input.targetGradeCode,
      sourceSubject: input.sourceSubject,
      targetSubject: input.targetSubject,
      sourceMarksMax: input.sourceMarksMax,
      targetMarksMax: input.targetMarksMax,
      creditFactor: input.creditFactor,
      mappingStatus: input.mappingStatus,
      notes: input.notes ?? null,
    };
    if (existing) {
      const index = this.rules.indexOf(existing);
      this.rules[index] = rule;
    } else {
      this.rules.push(rule);
    }
    return rule;
  }

  async deleteEquivalency(tenantId: string, id: string): Promise<boolean> {
    const index = this.rules.findIndex((rule) => rule.id === id && rule.tenantId === tenantId);
    if (index < 0) return false;
    this.rules.splice(index, 1);
    return true;
  }

  private completeEnrollment(row: TransferWorkflowRow): string {
    const source = this.enrollments.get(this.key(row.tenantId, row.sourceEnrollmentId));
    if (!source || source.status !== 'ENROLLED' || source.studentId !== row.studentId) {
      throw new BusinessRuleError('Source enrollment must be ENROLLED for this student');
    }
    source.status = 'TRANSFERRED';
    const destinationId = uuidv4();
    this.enrollments.set(this.key(row.tenantId, destinationId), {
      id: destinationId,
      tenantId: row.tenantId,
      studentId: row.studentId,
      institutionId: row.destinationInstitutionId,
      status: 'ENROLLED',
    });
    return destinationId;
  }

  private key(tenantId: string, id: string): string {
    return `${tenantId}:${id}`;
  }
}
