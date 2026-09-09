/**
 * G-908 examination ops: invigilator allocation (clash check), persisted
 * seating, double marks entry with variance, re-evaluation workflow.
 */
import { randomUUID } from 'node:crypto';

import {
  AppError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@proctira/common';
import type { FieldError } from '@proctira/common';

import {
  findRoomClashes,
  findStaffClashes,
  type AllocationConflict,
  type TimedSlot,
} from './clash.js';
import type { DocumentRepository } from './document-repository.js';
import type { ExaminationRepository } from './examination-repository.js';
import type {
  AllocateInvigilatorInput,
  AssignReevaluationInput,
  CompleteReevaluationInput,
  CreateExamSessionInput,
  CreateReevaluationInput,
  GenerateSeatingInput,
  RecordDoubleEntryInput,
  RejectReevaluationInput,
  ResolveMarksInput,
} from './ops-schemas.js';
import type {
  ExamInvigilatorRecord,
  ExamMarksEntryRecord,
  ExamOpsAuditRecord,
  ExamOpsStore,
  ExamReevaluationRecord,
  ExamSeatingRecord,
  ExamSessionRecord,
} from './ops-store.js';
import { generateSeatingPlan } from './seating-generator.js';

export const DEFAULT_VARIANCE_TOLERANCE = 2;

const MODERATOR_ROLES = new Set([
  'moderator',
  'super_admin',
  'super_administrator',
  'administrator',
  'admin',
  'principal',
  'examinations_officer',
]);

export function normalizeRoleName(role: string): string {
  return role
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function isModeratorRole(roles: string[]): boolean {
  return roles.some((role) => MODERATOR_ROLES.has(normalizeRoleName(role)));
}

export interface ExamOpsActor {
  userId: string;
  roles: string[];
}

export interface ExamOpsServiceDeps {
  store: ExamOpsStore;
  examinations: ExaminationRepository;
  documents?: DocumentRepository;
  varianceTolerance?: number;
  onAudit?: (entry: ExamOpsAuditRecord) => void | Promise<void>;
}

export interface AllocateResult {
  ok: true;
  allocation: ExamInvigilatorRecord;
}

export interface AllocateConflictResult {
  ok: false;
  conflicts: AllocationConflict[];
}

export type AllocateOutcome = AllocateResult | AllocateConflictResult;

export interface CreateSessionResult {
  ok: true;
  session: ExamSessionRecord;
}

export interface CreateSessionConflictResult {
  ok: false;
  conflicts: AllocationConflict[];
}

export type CreateSessionOutcome = CreateSessionResult | CreateSessionConflictResult;

export interface MarksPairView {
  candidateId: string;
  subjectId: string;
  entry1: ExamMarksEntryRecord | null;
  entry2: ExamMarksEntryRecord | null;
  varianceFlag: boolean;
  variance: number | null;
  finalMarks: number | null;
  resolved: boolean;
}

function toSlot(session: ExamSessionRecord): TimedSlot {
  return {
    id: session.id,
    date: session.date,
    startTime: session.startTime,
    endTime: session.endTime,
    roomId: session.roomId,
  };
}

export class ExamOpsService {
  private readonly store: ExamOpsStore;
  private readonly examinations: ExaminationRepository;
  private readonly documents?: DocumentRepository;
  private readonly varianceTolerance: number;
  private readonly onAudit?: ExamOpsServiceDeps['onAudit'];
  private readonly localAudits: ExamOpsAuditRecord[] = [];

  constructor(deps: ExamOpsServiceDeps) {
    this.store = deps.store;
    this.examinations = deps.examinations;
    this.documents = deps.documents;
    this.varianceTolerance = deps.varianceTolerance ?? DEFAULT_VARIANCE_TOLERANCE;
    this.onAudit = deps.onAudit;
  }

  private async requireExam(tenantId: string, examinationId: string) {
    const exam = await this.examinations.findById(examinationId, tenantId);
    if (!exam) throw new NotFoundError(`Examination with id '${examinationId}' not found`);
    return exam;
  }

  private async audit(
    tenantId: string,
    examinationId: string,
    action: string,
    entityType: string,
    entityId: string,
    actorId: string | null,
    details: Record<string, unknown>,
  ): Promise<void> {
    const entry: ExamOpsAuditRecord = {
      id: randomUUID(),
      tenantId,
      examinationId,
      action,
      entityType,
      entityId,
      actorId,
      at: new Date(),
      details,
    };
    this.localAudits.push(entry);
    await this.store.appendAudit(entry);
    await this.onAudit?.(entry);
  }

  async listAudits(tenantId: string, examinationId: string): Promise<ExamOpsAuditRecord[]> {
    const stored = await this.store.listAudits(tenantId, examinationId);
    const local = this.localAudits.filter(
      (row) => row.tenantId === tenantId && row.examinationId === examinationId,
    );
    const byId = new Map<string, ExamOpsAuditRecord>();
    for (const row of [...stored, ...local]) byId.set(row.id, row);
    return [...byId.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
  }

  async listSessions(tenantId: string, examinationId: string): Promise<ExamSessionRecord[]> {
    await this.requireExam(tenantId, examinationId);
    return this.store.listSessions(tenantId, examinationId);
  }

  async createSession(
    tenantId: string,
    examinationId: string,
    input: CreateExamSessionInput,
    actor: ExamOpsActor,
  ): Promise<CreateSessionOutcome> {
    const exam = await this.requireExam(tenantId, examinationId);
    if (!exam.subjects.some((s) => s.id === input.subjectId)) {
      throw new ValidationError('Subject is not part of this examination', [
        {
          field: 'subjectId',
          rule: 'exists',
          message: `Subject '${input.subjectId}' is not part of this examination`,
        },
      ]);
    }
    if (input.endTime <= input.startTime) {
      throw new ValidationError('End time must be after start time', [
        { field: 'endTime', rule: 'range', message: 'End time must be after start time' },
      ]);
    }
    const now = new Date();
    const session: ExamSessionRecord = {
      id: randomUUID(),
      tenantId,
      examinationId,
      subjectId: input.subjectId,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      roomId: input.roomId.trim(),
      centerId: input.centerId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    const existing = await this.store.listSessionsByTenant(tenantId);
    const conflicts = findRoomClashes(toSlot(session), existing.map(toSlot));
    if (conflicts.length > 0) return { ok: false, conflicts };

    const saved = await this.store.createSession(session);
    await this.audit(
      tenantId,
      examinationId,
      'session.create',
      'exam_session',
      saved.id,
      actor.userId,
      {
        roomId: saved.roomId,
        date: saved.date,
      },
    );
    return { ok: true, session: saved };
  }

  async deleteSession(tenantId: string, examinationId: string, sessionId: string): Promise<void> {
    await this.requireExam(tenantId, examinationId);
    const existing = await this.store.findSession(tenantId, sessionId);
    if (!existing || existing.examinationId !== examinationId) {
      throw new NotFoundError(`Exam session '${sessionId}' not found`);
    }
    await this.store.deleteSession(tenantId, sessionId);
  }

  async listInvigilators(
    tenantId: string,
    examinationId: string,
    sessionId: string,
  ): Promise<ExamInvigilatorRecord[]> {
    await this.requireExam(tenantId, examinationId);
    const session = await this.store.findSession(tenantId, sessionId);
    if (!session || session.examinationId !== examinationId) {
      throw new NotFoundError(`Exam session '${sessionId}' not found`);
    }
    return this.store.listInvigilators(tenantId, sessionId);
  }

  async allocateInvigilator(
    tenantId: string,
    examinationId: string,
    sessionId: string,
    input: AllocateInvigilatorInput,
    actor: ExamOpsActor,
  ): Promise<AllocateOutcome> {
    await this.requireExam(tenantId, examinationId);
    const session = await this.store.findSession(tenantId, sessionId);
    if (!session || session.examinationId !== examinationId) {
      throw new NotFoundError(`Exam session '${sessionId}' not found`);
    }

    const already = await this.store.listInvigilators(tenantId, sessionId);
    if (already.some((row) => row.staffId === input.staffId)) {
      throw new ConflictError(`Staff '${input.staffId}' is already allocated to this session`);
    }

    const examSessions = await this.store.listSessionsByTenant(tenantId);
    const sessionsById = new Map(examSessions.map((s) => [s.id, toSlot(s)] as const));
    const assignments = await this.store.listInvigilatorsByTenant(tenantId);
    const conflicts = findStaffClashes(
      toSlot(session),
      input.staffId,
      sessionsById,
      assignments.map((a) => ({ sessionId: a.sessionId, staffId: a.staffId })),
    );
    if (conflicts.length > 0) return { ok: false, conflicts };

    const allocation = await this.store.createInvigilator({
      id: randomUUID(),
      tenantId,
      sessionId,
      staffId: input.staffId,
      allocatedAt: new Date(),
      allocatedBy: actor.userId || null,
    });
    await this.audit(
      tenantId,
      examinationId,
      'invigilator.allocate',
      'exam_invigilator',
      allocation.id,
      actor.userId,
      { staffId: input.staffId, sessionId },
    );
    return { ok: true, allocation };
  }

  async removeInvigilator(
    tenantId: string,
    examinationId: string,
    sessionId: string,
    allocationId: string,
  ): Promise<void> {
    await this.requireExam(tenantId, examinationId);
    const row = await this.store.findInvigilator(tenantId, allocationId);
    if (!row || row.sessionId !== sessionId) {
      throw new NotFoundError(`Invigilator allocation '${allocationId}' not found`);
    }
    await this.store.deleteInvigilator(tenantId, allocationId);
  }

  async listSeating(tenantId: string, examinationId: string): Promise<ExamSeatingRecord[]> {
    await this.requireExam(tenantId, examinationId);
    return this.store.listSeating(tenantId, examinationId);
  }

  async generateSeating(
    tenantId: string,
    examinationId: string,
    input: GenerateSeatingInput,
    actor: ExamOpsActor,
  ): Promise<ExamSeatingRecord[]> {
    const exam = await this.requireExam(tenantId, examinationId);
    const registrations = await this.examinations.listCandidateRegistrations(
      examinationId,
      tenantId,
    );
    const docs = this.documents
      ? await this.documents.getDocumentCandidates(examinationId, tenantId)
      : [];
    const docById = new Map(docs.map((d) => [d.id, d] as const));
    const centerName = new Map(exam.centers.map((c) => [c.id, c.name] as const));
    const subjectName = new Map(exam.subjects.map((s) => [s.id, s.name] as const));

    const candidates = registrations.map((reg) => {
      const doc = docById.get(reg.id);
      return {
        candidateId: reg.id,
        studentId: reg.studentId,
        studentName: doc?.studentName ?? reg.studentId,
        rollNumber: doc?.rollNumber ?? reg.id,
        centerId: reg.centerId,
        centerName: doc?.centerName ?? centerName.get(reg.centerId) ?? reg.centerId,
        subjectNames: doc?.subjectNames ?? reg.subjectIds.map((id) => subjectName.get(id) ?? id),
      };
    });

    const generated = generateSeatingPlan(candidates, input.seatsPerRoom);
    const now = new Date();
    const sessionId = input.sessionId ?? null;
    if (sessionId) {
      const session = await this.store.findSession(tenantId, sessionId);
      if (!session || session.examinationId !== examinationId) {
        throw new NotFoundError(`Exam session '${sessionId}' not found`);
      }
    }

    const seats: ExamSeatingRecord[] = generated.map((seat) => ({
      id: randomUUID(),
      tenantId,
      examinationId,
      sessionId,
      candidateId: seat.candidateId,
      studentId: seat.studentId,
      studentName: seat.studentName,
      rollNumber: seat.rollNumber,
      centerId: seat.centerId,
      centerName: seat.centerName,
      roomNumber: seat.roomNumber,
      seatNumber: seat.seatNumber,
      subjectNames: seat.subjectNames,
      generatedAt: now,
    }));

    const saved = await this.store.replaceSeating(tenantId, examinationId, seats);
    await this.audit(
      tenantId,
      examinationId,
      'seating.generate',
      'exam_seating',
      examinationId,
      actor.userId,
      { count: saved.length },
    );
    return saved;
  }

  async listMarksPairs(tenantId: string, examinationId: string): Promise<MarksPairView[]> {
    await this.requireExam(tenantId, examinationId);
    const entries = await this.store.listMarksEntries(tenantId, examinationId);
    const grouped = new Map<string, ExamMarksEntryRecord[]>();
    for (const entry of entries) {
      const key = `${entry.candidateId}:${entry.subjectId}`;
      const list = grouped.get(key) ?? [];
      list.push(entry);
      grouped.set(key, list);
    }
    return [...grouped.entries()].map(([, list]) => {
      const entry1 = list.find((e) => e.entryNo === 1) ?? null;
      const entry2 = list.find((e) => e.entryNo === 2) ?? null;
      const variance = entry1 && entry2 ? Math.abs(entry1.marks - entry2.marks) : null;
      const finalMarks = entry1?.finalMarks ?? entry2?.finalMarks ?? null;
      return {
        candidateId: (entry1 ?? entry2)!.candidateId,
        subjectId: (entry1 ?? entry2)!.subjectId,
        entry1,
        entry2,
        varianceFlag: Boolean(entry1?.varianceFlag || entry2?.varianceFlag),
        variance,
        finalMarks,
        resolved: finalMarks !== null,
      };
    });
  }

  async recordDoubleEntry(
    tenantId: string,
    examinationId: string,
    input: RecordDoubleEntryInput,
    actor: ExamOpsActor,
  ): Promise<ExamMarksEntryRecord> {
    const exam = await this.requireExam(tenantId, examinationId);
    if (!exam.subjects.some((s) => s.id === input.subjectId)) {
      throw new ValidationError('Subject is not part of this examination', [
        {
          field: 'subjectId',
          rule: 'exists',
          message: `Subject '${input.subjectId}' is not part of this examination`,
        },
      ]);
    }
    const registration = await this.examinations.listCandidateRegistrations(
      examinationId,
      tenantId,
    );
    if (!registration.some((r) => r.id === input.candidateId)) {
      throw new NotFoundError(`Candidate '${input.candidateId}' is not registered`);
    }
    if (!actor.userId) {
      throw new AppError('Authenticated actor is required', 'UNAUTHORIZED', 401);
    }

    const pair = await this.store.findMarksPair(
      tenantId,
      examinationId,
      input.candidateId,
      input.subjectId,
    );
    const existing = pair.find((e) => e.entryNo === input.entryNo);
    if (existing) {
      throw new ConflictError(`Entry ${input.entryNo} already recorded for this candidate/subject`);
    }
    if (input.entryNo === 2) {
      const first = pair.find((e) => e.entryNo === 1);
      if (!first) {
        throw new BusinessRuleError('First marks entry must be recorded before the second');
      }
      if (first.enteredBy === actor.userId) {
        throw new BusinessRuleError('Second marks entry must be recorded by a different user');
      }
    }

    const first = pair.find((e) => e.entryNo === 1);
    const tolerance = input.tolerance ?? this.varianceTolerance;
    let varianceFlag = false;
    if (input.entryNo === 2 && first) {
      varianceFlag = Math.abs(first.marks - input.marks) > tolerance;
    }

    const record = await this.store.createMarksEntry({
      id: randomUUID(),
      tenantId,
      examinationId,
      candidateId: input.candidateId,
      subjectId: input.subjectId,
      entryNo: input.entryNo,
      marks: input.marks,
      enteredBy: actor.userId,
      enteredAt: new Date(),
      varianceFlag,
      finalMarks: null,
      resolvedBy: null,
      resolvedAt: null,
    });

    if (varianceFlag && first) {
      await this.store.updateMarksEntries(tenantId, [first.id, record.id], { varianceFlag: true });
    }

    await this.audit(
      tenantId,
      examinationId,
      'marks.entry',
      'exam_marks_entry',
      record.id,
      actor.userId,
      { entryNo: input.entryNo, varianceFlag, marks: input.marks },
    );
    return { ...record, varianceFlag };
  }

  async resolveMarks(
    tenantId: string,
    examinationId: string,
    input: ResolveMarksInput,
    actor: ExamOpsActor,
  ): Promise<MarksPairView> {
    await this.requireExam(tenantId, examinationId);
    if (!isModeratorRole(actor.roles)) {
      throw new AppError('Resolving marks variance requires a moderator role', 'FORBIDDEN', 403);
    }
    const pair = await this.store.findMarksPair(
      tenantId,
      examinationId,
      input.candidateId,
      input.subjectId,
    );
    if (pair.length < 2) {
      throw new BusinessRuleError('Both marks entries are required before resolution');
    }
    await this.store.updateMarksEntries(
      tenantId,
      pair.map((p) => p.id),
      {
        finalMarks: input.finalMarks,
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
      },
    );
    await this.audit(
      tenantId,
      examinationId,
      'marks.resolve',
      'exam_marks_entry',
      input.candidateId,
      actor.userId,
      { subjectId: input.subjectId, finalMarks: input.finalMarks },
    );
    const views = await this.listMarksPairs(tenantId, examinationId);
    const view = views.find(
      (v) => v.candidateId === input.candidateId && v.subjectId === input.subjectId,
    );
    if (!view) throw new NotFoundError('Marks pair not found after resolve');
    return view;
  }

  async listReevaluations(
    tenantId: string,
    examinationId: string,
  ): Promise<ExamReevaluationRecord[]> {
    await this.requireExam(tenantId, examinationId);
    return this.store.listReevaluations(tenantId, examinationId);
  }

  async requestReevaluation(
    tenantId: string,
    examinationId: string,
    input: CreateReevaluationInput,
    actor: ExamOpsActor,
  ): Promise<ExamReevaluationRecord> {
    await this.requireExam(tenantId, examinationId);
    if (!actor.userId) {
      throw new AppError('Authenticated actor is required', 'UNAUTHORIZED', 401);
    }
    const registrations = await this.examinations.listCandidateRegistrations(
      examinationId,
      tenantId,
    );
    if (!registrations.some((r) => r.id === input.candidateId)) {
      throw new NotFoundError(`Candidate '${input.candidateId}' is not registered`);
    }
    const now = new Date();
    const record = await this.store.createReevaluation({
      id: randomUUID(),
      tenantId,
      examinationId,
      candidateId: input.candidateId,
      subjectId: input.subjectId,
      status: 'requested',
      requesterId: actor.userId,
      requesterRole: input.requesterRole ?? 'staff',
      evaluatorId: null,
      originalMarks: input.originalMarks ?? null,
      revisedMarks: null,
      feeRequired: input.feeRequired ?? false,
      feeAmount: input.feeAmount ?? null,
      notes: input.notes?.trim() || null,
      createdAt: now,
      updatedAt: now,
    });
    await this.audit(
      tenantId,
      examinationId,
      'reevaluation.request',
      'exam_reevaluation_request',
      record.id,
      actor.userId,
      { candidateId: input.candidateId, subjectId: input.subjectId },
    );
    return record;
  }

  async assignReevaluation(
    tenantId: string,
    examinationId: string,
    requestId: string,
    input: AssignReevaluationInput,
    actor: ExamOpsActor,
  ): Promise<ExamReevaluationRecord> {
    await this.requireExam(tenantId, examinationId);
    const existing = await this.store.findReevaluation(tenantId, requestId);
    if (!existing || existing.examinationId !== examinationId) {
      throw new NotFoundError(`Re-evaluation request '${requestId}' not found`);
    }
    if (existing.status !== 'requested') {
      throw new BusinessRuleError(`Cannot assign a re-evaluation in '${existing.status}' status`);
    }
    const updated = await this.store.updateReevaluation(tenantId, requestId, {
      status: 'assigned',
      evaluatorId: input.evaluatorId,
    });
    if (!updated) throw new NotFoundError(`Re-evaluation request '${requestId}' not found`);
    await this.audit(
      tenantId,
      examinationId,
      'reevaluation.assign',
      'exam_reevaluation_request',
      requestId,
      actor.userId,
      { evaluatorId: input.evaluatorId },
    );
    return updated;
  }

  async completeReevaluation(
    tenantId: string,
    examinationId: string,
    requestId: string,
    input: CompleteReevaluationInput,
    actor: ExamOpsActor,
  ): Promise<ExamReevaluationRecord> {
    await this.requireExam(tenantId, examinationId);
    const existing = await this.store.findReevaluation(tenantId, requestId);
    if (!existing || existing.examinationId !== examinationId) {
      throw new NotFoundError(`Re-evaluation request '${requestId}' not found`);
    }
    if (existing.status !== 'assigned') {
      throw new BusinessRuleError(`Cannot complete a re-evaluation in '${existing.status}' status`);
    }
    const notes = [existing.notes, input.notes?.trim()].filter(Boolean).join('\n') || null;
    const updated = await this.store.updateReevaluation(tenantId, requestId, {
      status: 'completed',
      revisedMarks: input.revisedMarks,
      notes,
    });
    if (!updated) throw new NotFoundError(`Re-evaluation request '${requestId}' not found`);
    const original = existing.originalMarks ?? 0;
    const delta = input.revisedMarks - original;
    await this.audit(
      tenantId,
      examinationId,
      'reevaluation.complete',
      'exam_reevaluation_request',
      requestId,
      actor.userId,
      {
        originalMarks: existing.originalMarks,
        revisedMarks: input.revisedMarks,
        delta,
        published: true,
      },
    );
    return updated;
  }

  async rejectReevaluation(
    tenantId: string,
    examinationId: string,
    requestId: string,
    input: RejectReevaluationInput,
    actor: ExamOpsActor,
  ): Promise<ExamReevaluationRecord> {
    await this.requireExam(tenantId, examinationId);
    const existing = await this.store.findReevaluation(tenantId, requestId);
    if (!existing || existing.examinationId !== examinationId) {
      throw new NotFoundError(`Re-evaluation request '${requestId}' not found`);
    }
    if (existing.status === 'completed') {
      throw new BusinessRuleError('Cannot reject a completed re-evaluation');
    }
    const notes = [existing.notes, input.notes?.trim()].filter(Boolean).join('\n') || null;
    const updated = await this.store.updateReevaluation(tenantId, requestId, {
      status: 'rejected',
      notes,
    });
    if (!updated) throw new NotFoundError(`Re-evaluation request '${requestId}' not found`);
    await this.audit(
      tenantId,
      examinationId,
      'reevaluation.reject',
      'exam_reevaluation_request',
      requestId,
      actor.userId,
      {},
    );
    return updated;
  }
}

export function conflictResponse(conflicts: AllocationConflict[]) {
  const errors: FieldError[] = conflicts.map((c) => ({
    field: c.kind === 'room_overlap' ? 'roomId' : 'staffId',
    rule: c.kind,
    message: c.message,
  }));
  return {
    code: 'CONFLICT',
    message: conflicts[0]?.message ?? 'Allocation conflict',
    statusCode: 409,
    conflicts,
    errors,
  };
}
