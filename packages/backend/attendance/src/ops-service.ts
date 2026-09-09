/**
 * G-919 attendance ops: regularisation state machine, student leave,
 * device ingest. Self-contained request/approve (not WorkflowService).
 */
import { AppError, AttendanceStatus, BusinessRuleError, NotFoundError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { AttendanceRepository, StudentAttendanceEntity } from './attendance-repository.js';
import type {
  CreateLeaveRequestInput,
  CreateRegularisationInput,
  IngestBatchInput,
  RegisterDeviceInput,
} from './ops-schemas.js';
import {
  hashDeviceApiKey,
  mintDeviceApiKey,
  type AttendanceOpsStore,
  type LeaveRequestRecord,
  type RegularisationRecord,
} from './ops-store.js';

/** EARLY_DEPARTURE present-partial weight (G-919). */
export const EARLY_DEPARTURE_PRESENT_WEIGHT = 0.5;

const APPROVER_ROLES = new Set([
  'admin',
  'super_admin',
  'super-admin',
  'administrator',
  'principal',
  'registrar',
  'attendance_officer',
  'attendance-officer',
]);

export function isAttendanceApprover(roles: string[]): boolean {
  return roles.some((r) =>
    APPROVER_ROLES.has(
      r
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_'),
    ),
  );
}

export interface OpsActor {
  userId: string;
  roles: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function weekdayDates(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function punchHour(iso: string): number {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? 12 : t.getUTCHours();
}

export class AttendanceOpsService {
  constructor(
    private readonly store: AttendanceOpsStore,
    private readonly attendance: AttendanceRepository,
  ) {}

  listRegularisations(tenantId: string, status?: RegularisationRecord['status']) {
    return this.store.listRegularisations(tenantId, status ? { status } : undefined);
  }

  async requestRegularisation(
    tenantId: string,
    input: CreateRegularisationInput,
    actor: OpsActor,
  ): Promise<RegularisationRecord> {
    const now = nowIso();
    return this.store.createRegularisation({
      id: uuidv4(),
      tenantId,
      attendanceId: input.attendanceId,
      studentId: input.studentId,
      institutionId: input.institutionId,
      classId: input.classId,
      attendanceDate: input.attendanceDate,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      reason: input.reason ?? null,
      requesterId: actor.userId,
      requesterRole: actor.roles[0] ?? null,
      status: 'requested',
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async decideRegularisation(
    tenantId: string,
    id: string,
    decision: 'approved' | 'rejected',
    actor: OpsActor,
    note?: string,
  ): Promise<RegularisationRecord> {
    if (!isAttendanceApprover(actor.roles)) {
      throw new AppError('Forbidden: role cannot decide regularisation', 'FORBIDDEN', 403);
    }
    const row = await this.store.getRegularisation(tenantId, id);
    if (!row) throw new NotFoundError(`Regularisation '${id}' not found`);
    if (row.status !== 'requested') {
      throw new BusinessRuleError(`Regularisation is already ${row.status}`);
    }
    if (decision === 'approved') {
      const updated = await this.attendance.updateStudentAttendance(row.attendanceId, tenantId, {
        status: row.toStatus as AttendanceStatus,
      });
      if (!updated) {
        throw new NotFoundError(`Attendance record '${row.attendanceId}' not found`);
      }
      await this.attendance.createAuditEntry({
        id: uuidv4(),
        tenantId,
        attendanceId: row.attendanceId,
        previousStatus: row.fromStatus as AttendanceStatus,
        newStatus: row.toStatus as AttendanceStatus,
        changedBy: actor.userId,
        changedAt: new Date(),
      });
    }
    const next = await this.store.updateRegularisation(tenantId, id, {
      status: decision,
      decidedBy: actor.userId,
      decidedAt: nowIso(),
      decisionNote: note ?? null,
    });
    if (!next) throw new NotFoundError(`Regularisation '${id}' not found`);
    return next;
  }

  listLeaves(tenantId: string, status?: LeaveRequestRecord['status']) {
    return this.store.listLeaves(tenantId, status ? { status } : undefined);
  }

  async requestLeave(
    tenantId: string,
    input: CreateLeaveRequestInput,
    actor: OpsActor,
  ): Promise<LeaveRequestRecord> {
    if (input.toDate < input.fromDate) {
      throw new BusinessRuleError('toDate must be on or after fromDate');
    }
    const now = nowIso();
    return this.store.createLeave({
      id: uuidv4(),
      tenantId,
      studentId: input.studentId,
      institutionId: input.institutionId,
      classId: input.classId,
      academicPeriodId: input.academicPeriodId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      reason: input.reason ?? null,
      attachmentUrl: input.attachmentUrl ?? null,
      requesterId: actor.userId,
      requesterRole: actor.roles[0] ?? null,
      status: 'requested',
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async decideLeave(
    tenantId: string,
    id: string,
    decision: 'approved' | 'rejected',
    actor: OpsActor,
    note?: string,
  ): Promise<LeaveRequestRecord> {
    if (!isAttendanceApprover(actor.roles)) {
      throw new AppError('Forbidden: role cannot decide leave', 'FORBIDDEN', 403);
    }
    const row = await this.store.getLeave(tenantId, id);
    if (!row) throw new NotFoundError(`Leave request '${id}' not found`);
    if (row.status !== 'requested') {
      throw new BusinessRuleError(`Leave request is already ${row.status}`);
    }
    if (decision === 'approved') {
      for (const date of weekdayDates(row.fromDate, row.toDate)) {
        await this.markExcusedDay(tenantId, row, date, actor.userId);
      }
    }
    const next = await this.store.updateLeave(tenantId, id, {
      status: decision,
      decidedBy: actor.userId,
      decidedAt: nowIso(),
      decisionNote: note ?? null,
    });
    if (!next) throw new NotFoundError(`Leave request '${id}' not found`);
    return next;
  }

  private async markExcusedDay(
    tenantId: string,
    row: LeaveRequestRecord,
    date: string,
    actorId: string,
  ): Promise<void> {
    const existing = await this.attendance.findStudentAttendance(
      tenantId,
      row.studentId,
      row.classId,
      date,
      null,
      null,
    );
    if (existing) {
      await this.attendance.updateStudentAttendance(existing.id, tenantId, {
        status: AttendanceStatus.EXCUSED,
        comment: row.reason ?? 'Leave approved',
      });
      await this.attendance.createAuditEntry({
        id: uuidv4(),
        tenantId,
        attendanceId: existing.id,
        previousStatus: existing.status,
        newStatus: AttendanceStatus.EXCUSED,
        changedBy: actorId,
        changedAt: new Date(),
      });
      return;
    }
    const created: StudentAttendanceEntity = await this.attendance.createStudentAttendance({
      id: uuidv4(),
      tenantId,
      studentId: row.studentId,
      institutionId: row.institutionId,
      classId: row.classId,
      academicPeriodId: row.academicPeriodId,
      date,
      subjectId: null,
      periodId: null,
      status: AttendanceStatus.EXCUSED,
      comment: row.reason ?? 'Leave approved',
      recordedBy: actorId,
    });
    await this.attendance.createAuditEntry({
      id: uuidv4(),
      tenantId,
      attendanceId: created.id,
      previousStatus: null,
      newStatus: AttendanceStatus.EXCUSED,
      changedBy: actorId,
      changedAt: new Date(),
    });
  }

  async registerDevice(
    tenantId: string,
    input: RegisterDeviceInput,
    actor: OpsActor,
  ): Promise<{ device: { id: string; deviceId: string; institutionId: string }; apiKey: string }> {
    if (!isAttendanceApprover(actor.roles)) {
      throw new AppError('Forbidden: role cannot register devices', 'FORBIDDEN', 403);
    }
    const apiKey = mintDeviceApiKey();
    const device = await this.store.createDeviceKey({
      id: uuidv4(),
      tenantId,
      institutionId: input.institutionId,
      deviceId: input.deviceId,
      apiKeyHash: hashDeviceApiKey(apiKey),
      label: input.label ?? null,
      status: 'active',
      createdAt: nowIso(),
    });
    return {
      device: { id: device.id, deviceId: device.deviceId, institutionId: device.institutionId },
      apiKey,
    };
  }

  async ingest(
    tenantId: string,
    apiKeyHeader: string | undefined,
    input: IngestBatchInput,
  ): Promise<{
    accepted: number;
    duplicates: number;
    written: number;
    events: Array<{ eventId: string; duplicate: boolean; attendanceId: string | null }>;
  }> {
    if (!apiKeyHeader) {
      throw new AppError('X-Device-Api-Key header required', 'UNAUTHORIZED', 401);
    }
    const device = await this.store.findDeviceKeyByHash(tenantId, hashDeviceApiKey(apiKeyHeader));
    if (
      !device ||
      device.institutionId !== input.institutionId ||
      device.deviceId !== input.deviceId
    ) {
      throw new AppError('Invalid device API key for this institution', 'UNAUTHORIZED', 401);
    }

    let accepted = 0;
    let duplicates = 0;
    let written = 0;
    const events: Array<{ eventId: string; duplicate: boolean; attendanceId: string | null }> = [];

    for (const event of input.events) {
      const existing = await this.store.findIngestEvent(tenantId, input.deviceId, event.eventId);
      if (existing) {
        duplicates += 1;
        events.push({
          eventId: event.eventId,
          duplicate: true,
          attendanceId: existing.attendanceId,
        });
        continue;
      }
      let attendanceId: string | null = null;
      if (event.classId && event.academicPeriodId) {
        attendanceId = await this.applyPunch(tenantId, input.institutionId, event);
        if (attendanceId) written += 1;
      }
      await this.store.createIngestEvent({
        id: uuidv4(),
        tenantId,
        institutionId: input.institutionId,
        deviceId: input.deviceId,
        eventId: event.eventId,
        studentId: event.studentId,
        punchedAt: event.punchedAt,
        punchType: event.type,
        attendanceId,
        duplicate: false,
        createdAt: nowIso(),
      });
      accepted += 1;
      events.push({ eventId: event.eventId, duplicate: false, attendanceId });
    }

    return { accepted, duplicates, written, events };
  }

  private async applyPunch(
    tenantId: string,
    institutionId: string,
    event: IngestBatchInput['events'][number],
  ): Promise<string | null> {
    const classId = event.classId!;
    const academicPeriodId = event.academicPeriodId!;
    const date = event.punchedAt.slice(0, 10);
    const existing = await this.attendance.findStudentAttendance(
      tenantId,
      event.studentId,
      classId,
      date,
      null,
      null,
    );
    const status =
      event.type === 'OUT' && punchHour(event.punchedAt) < 15
        ? AttendanceStatus.EARLY_DEPARTURE
        : AttendanceStatus.PRESENT;

    if (existing) {
      await this.attendance.updateStudentAttendance(existing.id, tenantId, { status });
      return existing.id;
    }
    const created = await this.attendance.createStudentAttendance({
      id: uuidv4(),
      tenantId,
      studentId: event.studentId,
      institutionId,
      classId,
      academicPeriodId,
      date,
      subjectId: null,
      periodId: null,
      status,
      comment: `device ${event.type}`,
      recordedBy: '00000000-0000-4000-8000-0000000000de',
    });
    return created.id;
  }
}
