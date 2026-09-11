import { randomUUID } from 'node:crypto';

import { NotFoundError, ValidationError } from '@proctira/common';

import { detectMeetingClashes, detectSubstituteClashes } from './clash-helper.js';
import {
  InMemoryTimetableOpsStore,
  type GenerationJobRecord,
  type TeacherAbsenceRecord,
  type TimetableOpsStore,
} from './generation-store.js';
import {
  generateTimetable,
  type GenerateInput,
  type GeneratorDemand,
  type GeneratorPeriod,
  type GeneratorRoom,
} from './generation.js';
import type { CreateGenerationJobInput, CreateTeacherAbsenceInput } from './schemas.js';
import { isTimetableClashError, TimetableClashError } from './timetable-errors.js';
import type {
  BellScheduleEntity,
  PeriodEntity,
  RoomEntity,
  SectionEnrollmentEntity,
  SectionEntity,
  SectionMeetingEntity,
  SectionPublishStatus,
  SubstitutionEntity,
  TimetableRepository,
  ListBellSchedulesFilter,
  ListMeetingsFilter,
  ListRoomsFilter,
  ListSectionsFilter,
  ListSubstitutionsFilter,
} from './timetable-repository.js';

export interface TimetableAuditEntry {
  id: string;
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  at: string;
  details: Record<string, unknown>;
}

type BellScheduleInput = Omit<
  BellScheduleEntity,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'code'
> & { code?: string };
type PeriodInput = Omit<PeriodEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
type MeetingInput = Omit<SectionMeetingEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
type SectionInput = Omit<
  SectionEntity,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'status' | 'publishedAt' | 'code'
> & { code?: string; status?: SectionPublishStatus };
type RoomInput = Omit<RoomEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
type SubstitutionInput = {
  sectionMeetingId: string;
  substituteStaffId: string;
  substitutionDate: string;
  originalStaffId?: string;
  institutionId?: string;
  reason?: string | null;
  status?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function dateToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function slugCode(name: string, fallback: string): string {
  return (
    name
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || fallback
  );
}

function isoWeekday(isoDate: string): number {
  return ((new Date(`${isoDate}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export class TimetableService {
  private readonly auditLog: TimetableAuditEntry[] = [];
  private readonly ops: TimetableOpsStore;

  constructor(
    private readonly repo: TimetableRepository,
    ops?: TimetableOpsStore,
  ) {
    this.ops = ops ?? new InMemoryTimetableOpsStore();
  }

  listAudits(tenantId: string): TimetableAuditEntry[] {
    return this.auditLog.filter((row) => row.tenantId === tenantId);
  }

  private recordAudit(entry: Omit<TimetableAuditEntry, 'id' | 'at'>): void {
    this.auditLog.push({
      id: randomUUID(),
      at: nowIso(),
      ...entry,
    });
  }

  listBellSchedules(tenantId: string, filter?: ListBellSchedulesFilter) {
    return this.repo.listBellSchedules(tenantId, filter);
  }

  getBellSchedule(tenantId: string, id: string) {
    return this.repo.getBellSchedule(tenantId, id);
  }

  async createBellSchedule(tenantId: string, input: BellScheduleInput) {
    const now = nowIso();
    const code = input.code?.trim() || slugCode(input.name, 'BELL');
    const row = await this.repo.createBellSchedule({
      id: randomUUID(),
      tenantId,
      ...input,
      code,
      dayPattern: input.dayPattern ?? '1,2,3,4,5',
      status: input.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    });
    this.recordAudit({
      tenantId,
      action: 'bell_schedule.create',
      entityType: 'bell_schedule',
      entityId: row.id,
      actorId: null,
      details: { code: row.code, institutionId: row.institutionId },
    });
    return row;
  }

  async updateBellSchedule(tenantId: string, id: string, patch: Partial<BellScheduleInput>) {
    const row = await this.repo.updateBellSchedule(tenantId, id, patch);
    if (row) {
      this.recordAudit({
        tenantId,
        action: 'bell_schedule.update',
        entityType: 'bell_schedule',
        entityId: id,
        actorId: null,
        details: { patchKeys: Object.keys(patch) },
      });
    }
    return row;
  }

  async deleteBellSchedule(tenantId: string, id: string) {
    const ok = await this.repo.deleteBellSchedule(tenantId, id);
    if (ok) {
      this.recordAudit({
        tenantId,
        action: 'bell_schedule.delete',
        entityType: 'bell_schedule',
        entityId: id,
        actorId: null,
        details: {},
      });
    }
    return ok;
  }

  listPeriods(tenantId: string, bellScheduleId: string) {
    return this.repo.listPeriods(tenantId, bellScheduleId);
  }

  async createPeriod(tenantId: string, input: PeriodInput) {
    const schedule = await this.repo.getBellSchedule(tenantId, input.bellScheduleId);
    if (!schedule) {
      throw new NotFoundError(`Bell schedule ${input.bellScheduleId} not found`);
    }
    if (input.startTime >= input.endTime) {
      throw new ValidationError('Period startTime must be before endTime');
    }
    const now = nowIso();
    const row = await this.repo.createPeriod({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    this.recordAudit({
      tenantId,
      action: 'period.create',
      entityType: 'period',
      entityId: row.id,
      actorId: null,
      details: { bellScheduleId: row.bellScheduleId, periodOrder: row.periodOrder },
    });
    return row;
  }

  async updatePeriod(tenantId: string, id: string, patch: Partial<PeriodInput>) {
    const row = await this.repo.updatePeriod(tenantId, id, patch);
    if (row) {
      this.recordAudit({
        tenantId,
        action: 'period.update',
        entityType: 'period',
        entityId: id,
        actorId: null,
        details: { patchKeys: Object.keys(patch) },
      });
    }
    return row;
  }

  async deletePeriod(tenantId: string, id: string) {
    const ok = await this.repo.deletePeriod(tenantId, id);
    if (ok) {
      this.recordAudit({
        tenantId,
        action: 'period.delete',
        entityType: 'period',
        entityId: id,
        actorId: null,
        details: {},
      });
    }
    return ok;
  }

  listRooms(tenantId: string, filter?: ListRoomsFilter) {
    return this.repo.listRooms(tenantId, filter);
  }

  createRoom(tenantId: string, input: RoomInput) {
    const now = nowIso();
    return this.repo.createRoom({
      id: randomUUID(),
      tenantId,
      ...input,
      status: input.status ?? 'active',
      roomType: input.roomType ?? 'CLASSROOM',
      createdAt: now,
      updatedAt: now,
    });
  }

  listSections(tenantId: string, filter?: ListSectionsFilter) {
    return this.repo.listSections(tenantId, filter);
  }

  getSection(tenantId: string, id: string) {
    return this.repo.getSection(tenantId, id);
  }

  createSection(tenantId: string, input: SectionInput) {
    const now = nowIso();
    const code = input.code?.trim() || slugCode(input.name, 'SEC');
    return this.repo.createSection({
      id: randomUUID(),
      tenantId,
      institutionId: input.institutionId,
      academicPeriodId: input.academicPeriodId,
      gradeId: input.gradeId ?? null,
      code,
      name: input.name,
      primaryTeacherId: input.primaryTeacherId ?? null,
      defaultRoomId: input.defaultRoomId ?? null,
      capacity: input.capacity ?? 40,
      status: 'DRAFT',
      publishedAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async updateSection(tenantId: string, id: string, patch: Partial<SectionInput>) {
    const existing = await this.repo.getSection(tenantId, id);
    if (!existing) return null;
    if (existing.status === 'PUBLISHED') {
      throw new ValidationError('Published sections are locked; unpublish before editing');
    }
    return this.repo.updateSection(tenantId, id, patch);
  }

  async deleteSection(tenantId: string, id: string) {
    const existing = await this.repo.getSection(tenantId, id);
    if (!existing) return false;
    if (existing.status === 'PUBLISHED') {
      throw new ValidationError('Cannot delete a published section; archive or unpublish first');
    }
    return this.repo.deleteSection(tenantId, id);
  }

  listEnrollments(tenantId: string, sectionId: string) {
    return this.repo.listEnrollments(tenantId, sectionId);
  }

  async enrollStudent(tenantId: string, sectionId: string, studentId: string) {
    const section = await this.repo.getSection(tenantId, sectionId);
    if (!section) {
      throw new NotFoundError(`Section ${sectionId} not found`);
    }
    if (section.status === 'ARCHIVED') {
      throw new ValidationError('Cannot enroll into an archived section');
    }

    const existing = await this.repo.getEnrollment(tenantId, sectionId, studentId);
    if (existing && existing.status === 'ENROLLED') {
      return existing;
    }

    const active = (await this.repo.listEnrollments(tenantId, sectionId)).filter(
      (e) => e.status === 'ENROLLED',
    );
    if (!existing && active.length >= section.capacity) {
      throw new ValidationError(`Section ${section.code} is at capacity (${section.capacity})`);
    }

    const now = nowIso();
    if (existing) {
      return this.repo.updateEnrollment(tenantId, existing.id, {
        status: 'ENROLLED',
        withdrawnAt: null,
        enrolledAt: dateToday(),
      });
    }

    return this.repo.createEnrollment({
      id: randomUUID(),
      tenantId,
      sectionId,
      studentId,
      status: 'ENROLLED',
      enrolledAt: dateToday(),
      withdrawnAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  async withdrawStudent(tenantId: string, sectionId: string, studentId: string) {
    const enrollment = await this.repo.getEnrollment(tenantId, sectionId, studentId);
    if (!enrollment) {
      throw new NotFoundError(`Enrollment for student ${studentId} not found`);
    }
    if (enrollment.status === 'WITHDRAWN') {
      return enrollment;
    }
    return this.repo.updateEnrollment(tenantId, enrollment.id, {
      status: 'WITHDRAWN',
      withdrawnAt: dateToday(),
    });
  }

  /**
   * Bulk roster assign (G-304). Processes each student independently so one
   * capacity/validation failure does not roll back prior successes.
   */
  async bulkEnrollStudents(
    tenantId: string,
    sectionId: string,
    studentIds: string[],
  ): Promise<{
    enrolled: SectionEnrollmentEntity[];
    failed: Array<{ studentId: string; code: string; message: string }>;
  }> {
    const unique = [...new Set(studentIds.map((id) => id.trim()).filter(Boolean))];
    const enrolled: SectionEnrollmentEntity[] = [];
    const failed: Array<{ studentId: string; code: string; message: string }> = [];

    for (const studentId of unique) {
      try {
        const row = await this.enrollStudent(tenantId, sectionId, studentId);
        if (!row) {
          failed.push({
            studentId,
            code: 'ENROLL_FAILED',
            message: 'Enrollment update returned no row',
          });
          continue;
        }
        enrolled.push(row);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Enroll failed';
        const code =
          error instanceof NotFoundError
            ? 'NOT_FOUND'
            : error instanceof ValidationError
              ? 'VALIDATION_ERROR'
              : 'ENROLL_FAILED';
        failed.push({ studentId, code, message });
      }
    }

    this.recordAudit({
      tenantId,
      action: 'section.bulk_enroll',
      entityType: 'section',
      entityId: sectionId,
      actorId: null,
      details: {
        requested: unique.length,
        enrolled: enrolled.length,
        failed: failed.length,
      },
    });

    return { enrolled, failed };
  }

  /**
   * Surface the master-schedule conflict engine for an institution grid (G-304).
   * Returns unique staff/room/class clashes among active meetings.
   */
  async listConflicts(
    tenantId: string,
    filter: { institutionId: string; academicPeriodId?: string },
  ): Promise<
    Array<{
      reason: string;
      meetingId?: string;
      againstMeetingId: string;
      dayOfWeek: number;
      periodId: string;
      staffId?: string;
      sectionId?: string;
      roomId?: string | null;
    }>
  > {
    const meetings = await this.repo.listMeetings(tenantId, {
      institutionId: filter.institutionId,
      academicPeriodId: filter.academicPeriodId,
    });

    const seen = new Set<string>();
    const out: Array<{
      reason: string;
      meetingId?: string;
      againstMeetingId: string;
      dayOfWeek: number;
      periodId: string;
      staffId?: string;
      sectionId?: string;
      roomId?: string | null;
    }> = [];

    for (const candidate of meetings) {
      const conflicts = detectMeetingClashes(meetings, candidate, candidate.id);
      for (const c of conflicts) {
        const peer = c.meetingId ?? '';
        const pairKey = [candidate.id, peer].sort().join('|');
        const key = `${c.reason}|${pairKey}|${c.dayOfWeek}|${c.periodId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          reason: c.reason,
          meetingId: c.meetingId,
          againstMeetingId: candidate.id,
          dayOfWeek: c.dayOfWeek,
          periodId: c.periodId,
          staffId: c.staffId,
          sectionId: c.sectionId,
          roomId: c.roomId,
        });
      }
    }

    return out;
  }

  /**
   * Publish a draft section. Runs institution-wide room∩time and teacher∩time
   * clash detection including this section's meetings → 409 on conflict.
   */
  async publishSection(tenantId: string, sectionId: string): Promise<SectionEntity> {
    const section = await this.repo.getSection(tenantId, sectionId);
    if (!section) {
      throw new NotFoundError(`Section ${sectionId} not found`);
    }
    if (section.status === 'PUBLISHED') {
      return section;
    }
    if (section.status === 'ARCHIVED') {
      throw new ValidationError('Cannot publish an archived section');
    }

    const meetings = await this.repo.listMeetings(tenantId, {
      institutionId: section.institutionId,
      academicPeriodId: section.academicPeriodId,
    });
    const sectionMeetings = meetings.filter((m) => m.sectionId === sectionId);
    if (sectionMeetings.length === 0) {
      throw new ValidationError('Cannot publish a section with no meetings');
    }

    // Validate each of this section's meetings against the rest of the institution grid.
    for (const candidate of sectionMeetings) {
      const conflicts = detectMeetingClashes(meetings, candidate, candidate.id);
      const hard = conflicts.filter((c) => c.reason === 'staff' || c.reason === 'room');
      if (hard.length > 0) {
        throw new TimetableClashError(
          `Cannot publish section ${section.code}: ${hard.map((c) => c.reason).join(', ')} clash`,
          hard,
        );
      }
    }

    const updated = await this.repo.updateSection(tenantId, sectionId, {
      status: 'PUBLISHED',
      publishedAt: nowIso(),
    });
    if (!updated) {
      throw new NotFoundError(`Section ${sectionId} not found`);
    }
    this.recordAudit({
      tenantId,
      action: 'section.publish',
      entityType: 'section',
      entityId: sectionId,
      actorId: null,
      details: { code: section.code, meetingCount: sectionMeetings.length },
    });
    return updated;
  }

  async unpublishSection(tenantId: string, sectionId: string): Promise<SectionEntity> {
    const section = await this.repo.getSection(tenantId, sectionId);
    if (!section) {
      throw new NotFoundError(`Section ${sectionId} not found`);
    }
    if (section.status === 'DRAFT') {
      return section;
    }
    const updated = await this.repo.updateSection(tenantId, sectionId, {
      status: 'DRAFT',
      publishedAt: null,
    });
    if (!updated) {
      throw new NotFoundError(`Section ${sectionId} not found`);
    }
    this.recordAudit({
      tenantId,
      action: 'section.unpublish',
      entityType: 'section',
      entityId: sectionId,
      actorId: null,
      details: { code: section.code },
    });
    return updated;
  }

  listMeetings(tenantId: string, filter?: ListMeetingsFilter) {
    return this.repo.listMeetings(tenantId, filter);
  }

  getMeeting(tenantId: string, id: string) {
    return this.repo.getMeeting(tenantId, id);
  }

  async createMeeting(tenantId: string, input: MeetingInput) {
    await this.assertSectionEditable(tenantId, input.sectionId);
    await this.assertNoMeetingClash(tenantId, input);
    const now = nowIso();
    const row = await this.repo.createMeeting({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    });
    this.recordAudit({
      tenantId,
      action: 'meeting.create',
      entityType: 'section_meeting',
      entityId: row.id,
      actorId: null,
      details: {
        sectionId: row.sectionId,
        periodId: row.periodId,
        dayOfWeek: row.dayOfWeek,
        staffId: row.staffId,
      },
    });
    return row;
  }

  async updateMeeting(tenantId: string, id: string, patch: Partial<MeetingInput>) {
    const existing = await this.repo.getMeeting(tenantId, id);
    if (!existing) return null;
    await this.assertSectionEditable(tenantId, patch.sectionId ?? existing.sectionId);
    const candidate: MeetingInput = {
      institutionId: patch.institutionId ?? existing.institutionId,
      academicPeriodId: patch.academicPeriodId ?? existing.academicPeriodId,
      sectionId: patch.sectionId ?? existing.sectionId,
      subjectId: patch.subjectId !== undefined ? patch.subjectId : existing.subjectId,
      staffId: patch.staffId ?? existing.staffId,
      periodId: patch.periodId ?? existing.periodId,
      roomId: patch.roomId !== undefined ? patch.roomId : existing.roomId,
      dayOfWeek: patch.dayOfWeek ?? existing.dayOfWeek,
      status: patch.status ?? existing.status,
    };
    await this.assertNoMeetingClash(tenantId, candidate, id);
    const row = await this.repo.updateMeeting(tenantId, id, patch);
    if (row) {
      this.recordAudit({
        tenantId,
        action: 'meeting.update',
        entityType: 'section_meeting',
        entityId: id,
        actorId: null,
        details: { patchKeys: Object.keys(patch) },
      });
    }
    return row;
  }

  async deleteMeeting(tenantId: string, id: string) {
    const existing = await this.repo.getMeeting(tenantId, id);
    if (!existing) return false;
    await this.assertSectionEditable(tenantId, existing.sectionId);
    const ok = await this.repo.deleteMeeting(tenantId, id);
    if (ok) {
      this.recordAudit({
        tenantId,
        action: 'meeting.delete',
        entityType: 'section_meeting',
        entityId: id,
        actorId: null,
        details: { sectionId: existing.sectionId },
      });
    }
    return ok;
  }

  listSubstitutions(tenantId: string, filter?: ListSubstitutionsFilter) {
    return this.repo.listSubstitutions(tenantId, filter);
  }

  getSubstitution(tenantId: string, id: string) {
    return this.repo.getSubstitution(tenantId, id);
  }

  async createSubstitution(tenantId: string, input: SubstitutionInput) {
    const meeting = await this.repo.getMeeting(tenantId, input.sectionMeetingId);
    if (!meeting) {
      throw new NotFoundError(`Section meeting ${input.sectionMeetingId} not found`);
    }

    const originalStaffId = input.originalStaffId ?? meeting.staffId;
    const institutionId = input.institutionId ?? meeting.institutionId;

    if (originalStaffId === input.substituteStaffId) {
      throw new ValidationError('Substitute staff must differ from the original teacher');
    }

    const meetings = await this.repo.listMeetings(tenantId, {
      institutionId,
    });
    const substitutions = await this.repo.listSubstitutions(tenantId, {
      institutionId,
      fromDate: input.substitutionDate,
      toDate: input.substitutionDate,
    });

    const meetingById = new Map(meetings.map((m) => [m.id, m]));
    const enrichedSubs = [];
    for (const sub of substitutions) {
      const linked =
        meetingById.get(sub.sectionMeetingId) ??
        (await this.repo.getMeeting(tenantId, sub.sectionMeetingId));
      if (!linked) continue;
      enrichedSubs.push({
        id: sub.id,
        substituteStaffId: sub.substituteStaffId,
        periodId: linked.periodId,
        dayOfWeek: linked.dayOfWeek,
        substitutionDate: sub.substitutionDate,
        status: sub.status,
      });
    }

    const conflicts = detectSubstituteClashes({
      substituteStaffId: input.substituteStaffId,
      periodId: meeting.periodId,
      dayOfWeek: meeting.dayOfWeek,
      substitutionDate: input.substitutionDate,
      meetings,
      substitutions: enrichedSubs,
    });

    if (conflicts.length > 0) {
      throw new TimetableClashError(
        `Substitute teacher ${input.substituteStaffId} is already booked on ${input.substitutionDate}`,
        conflicts,
      );
    }

    const now = nowIso();
    const row = await this.repo.createSubstitution({
      id: randomUUID(),
      tenantId,
      institutionId,
      sectionMeetingId: input.sectionMeetingId,
      originalStaffId,
      substituteStaffId: input.substituteStaffId,
      substitutionDate: input.substitutionDate,
      reason: input.reason ?? null,
      status: input.status ?? 'scheduled',
      createdAt: now,
      updatedAt: now,
    });
    this.recordAudit({
      tenantId,
      action: 'substitution.create',
      entityType: 'substitution',
      entityId: row.id,
      actorId: null,
      details: {
        sectionMeetingId: row.sectionMeetingId,
        substituteStaffId: row.substituteStaffId,
        substitutionDate: row.substitutionDate,
      },
    });
    return row;
  }

  listAttendancePeriods(tenantId: string, filter: { institutionId: string; dayOfWeek?: number }) {
    return this.repo.listAttendancePeriods(tenantId, filter);
  }

  listGenerationJobs(tenantId: string, filter: { institutionId?: string }) {
    return this.ops.listJobs(tenantId, filter);
  }

  getGenerationJob(tenantId: string, id: string) {
    return this.ops.getJob(tenantId, id);
  }

  /**
   * Queue a generation job and run it synchronously in-process (G-917).
   */
  async runGenerationJob(
    tenantId: string,
    input: CreateGenerationJobInput,
    requestedBy: string | null,
  ): Promise<GenerationJobRecord> {
    const now = nowIso();
    const job = await this.ops.createJob({
      id: randomUUID(),
      tenantId,
      institutionId: input.institutionId,
      academicPeriodId: input.academicPeriodId,
      bellScheduleId: input.bellScheduleId ?? null,
      status: 'queued',
      requestedBy,
      persistMeetings: input.persistMeetings ?? false,
      teacherMaxPeriodsPerDay: input.teacherMaxPeriodsPerDay ?? 6,
      demandCount: input.demands.length,
      assignedCount: 0,
      unassignedCount: 0,
      clashCount: 0,
      repairPasses: 0,
      stats: {},
      input: input as unknown as Record<string, unknown>,
      result: {},
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      updatedAt: now,
    });

    await this.ops.updateJob(tenantId, job.id, {
      status: 'running',
      startedAt: nowIso(),
    });

    try {
      const periods = await this.resolvePeriods(tenantId, input);
      const rooms = await this.repo.listRooms(tenantId, { institutionId: input.institutionId });
      const generateInput: GenerateInput = {
        daysOfWeek: input.daysOfWeek ?? [1, 2, 3, 4, 5],
        periods,
        rooms: rooms.map((r): GeneratorRoom => ({ id: r.id, capacity: r.capacity })),
        demands: input.demands.map(
          (d): GeneratorDemand => ({
            id: d.id ?? randomUUID(),
            sectionId: d.sectionId,
            subjectId: d.subjectId,
            staffId: d.staffId,
            periodsPerWeek: d.periodsPerWeek,
            preferredRoomId: d.preferredRoomId ?? null,
            enrollmentCount: d.enrollmentCount ?? 0,
          }),
        ),
        unavailable: input.unavailable,
        teacherMaxPeriodsPerDay: input.teacherMaxPeriodsPerDay ?? 6,
      };
      const generated = generateTimetable(generateInput);

      let persisted = 0;
      let persistSkipped = 0;
      if (input.persistMeetings) {
        for (const assignment of generated.assignments) {
          try {
            await this.createMeeting(tenantId, {
              institutionId: input.institutionId,
              academicPeriodId: input.academicPeriodId,
              sectionId: assignment.sectionId,
              subjectId: assignment.subjectId,
              staffId: assignment.staffId,
              periodId: assignment.periodId,
              roomId: assignment.roomId,
              dayOfWeek: assignment.dayOfWeek,
              status: 'active',
            });
            persisted += 1;
          } catch (error) {
            if (isTimetableClashError(error)) {
              persistSkipped += 1;
              continue;
            }
            throw error;
          }
        }
      }

      const updated = await this.ops.updateJob(tenantId, job.id, {
        status: 'done',
        assignedCount: generated.assignments.length,
        unassignedCount: generated.unassigned.reduce((s, u) => s + u.remaining, 0),
        clashCount: generated.hardClashCount,
        repairPasses: generated.repairPasses,
        stats: {
          ...generated.stats,
          persisted,
          persistSkipped,
        },
        result: {
          assignments: generated.assignments,
          unassigned: generated.unassigned,
        },
        finishedAt: nowIso(),
      });
      this.recordAudit({
        tenantId,
        action: 'generation.run',
        entityType: 'generation_job',
        entityId: job.id,
        actorId: requestedBy,
        details: {
          assigned: generated.assignments.length,
          clashCount: generated.hardClashCount,
          persistMeetings: Boolean(input.persistMeetings),
        },
      });
      return updated ?? job;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'generation failed';
      const failed = await this.ops.updateJob(tenantId, job.id, {
        status: 'failed',
        errorMessage: message,
        finishedAt: nowIso(),
      });
      if (failed) return failed;
      throw error;
    }
  }

  async markTeacherAbsent(
    tenantId: string,
    input: CreateTeacherAbsenceInput,
    createdBy: string | null,
  ): Promise<{
    absence: TeacherAbsenceRecord;
    affected: Awaited<ReturnType<TimetableService['listAffectedPeriods']>>;
  }> {
    const absence = await this.ops.createAbsence({
      id: randomUUID(),
      tenantId,
      institutionId: input.institutionId,
      staffId: input.staffId,
      absenceDate: input.absenceDate,
      reason: input.reason ?? null,
      createdBy,
      createdAt: nowIso(),
    });
    const affected = await this.listAffectedPeriods(tenantId, {
      institutionId: input.institutionId,
      staffId: input.staffId,
      date: input.absenceDate,
    });
    this.recordAudit({
      tenantId,
      action: 'teacher_absence.create',
      entityType: 'teacher_absence',
      entityId: absence.id,
      actorId: createdBy,
      details: { staffId: input.staffId, date: input.absenceDate, affected: affected.length },
    });
    return { absence, affected };
  }

  async listAffectedPeriods(
    tenantId: string,
    filter: { institutionId: string; staffId: string; date: string },
  ) {
    const dayOfWeek = isoWeekday(filter.date);
    const meetings = await this.repo.listMeetings(tenantId, {
      institutionId: filter.institutionId,
      staffId: filter.staffId,
    });
    return meetings.filter((m) => m.dayOfWeek === dayOfWeek && m.status !== 'cancelled');
  }

  private async resolvePeriods(
    tenantId: string,
    input: CreateGenerationJobInput,
  ): Promise<GeneratorPeriod[]> {
    if (input.bellScheduleId) {
      const rows = await this.repo.listPeriods(tenantId, input.bellScheduleId);
      return rows.map((p) => ({
        id: p.id,
        startTime: p.startTime,
        endTime: p.endTime,
        periodOrder: p.periodOrder,
      }));
    }
    const schedules = await this.repo.listBellSchedules(tenantId, {
      institutionId: input.institutionId,
      academicPeriodId: input.academicPeriodId,
    });
    const first = schedules[0];
    if (!first) {
      throw new ValidationError('No bell schedule found; create periods before generating');
    }
    const rows = await this.repo.listPeriods(tenantId, first.id);
    if (rows.length === 0) {
      throw new ValidationError('Bell schedule has no periods');
    }
    return rows.map((p) => ({
      id: p.id,
      startTime: p.startTime,
      endTime: p.endTime,
      periodOrder: p.periodOrder,
    }));
  }

  private async assertSectionEditable(tenantId: string, sectionId: string): Promise<void> {
    const section = await this.repo.getSection(tenantId, sectionId);
    if (!section) {
      // Allow meetings against opaque section ids that predate WS2 store
      // (in-memory tests / legacy grids). Live PG will FK-fail if missing.
      return;
    }
    if (section.status === 'PUBLISHED') {
      throw new ValidationError('Published schedule is locked; unpublish before editing meetings');
    }
  }

  private async assertNoMeetingClash(
    tenantId: string,
    candidate: MeetingInput,
    excludeMeetingId?: string,
  ): Promise<void> {
    const meetings = await this.repo.listMeetings(tenantId, {
      institutionId: candidate.institutionId,
    });
    const conflicts = detectMeetingClashes(meetings, candidate, excludeMeetingId);
    if (conflicts.length > 0) {
      const reasons = [...new Set(conflicts.map((c) => c.reason))].join(', ');
      throw new TimetableClashError(
        `Timetable clash on day ${candidate.dayOfWeek} period ${candidate.periodId} (${reasons})`,
        conflicts,
      );
    }
  }
  /** G-5 — clone published sections + meetings into a target academic period. */
  async cloneForAcademicPeriod(
    tenantId: string,
    sourcePeriodId: string,
    targetPeriodId: string,
    options: { dryRun?: boolean } = {},
  ): Promise<{ sectionsCloned: number; meetingsCloned: number }> {
    if (sourcePeriodId === targetPeriodId) {
      throw new ValidationError('Source and target academic periods must differ');
    }
    const sections = await this.repo.listSections(tenantId, { academicPeriodId: sourcePeriodId });
    const existingTarget = await this.repo.listSections(tenantId, {
      academicPeriodId: targetPeriodId,
    });
    const existingKeys = new Set(
      existingTarget.map((s) => `${s.institutionId}|${s.code}`.toLowerCase()),
    );
    if (options.dryRun) {
      const toClone = sections.filter(
        (s) => !existingKeys.has(`${s.institutionId}|${s.code}`.toLowerCase()),
      );
      const meetings = await this.repo.listMeetings(tenantId, { academicPeriodId: sourcePeriodId });
      const sectionIds = new Set(toClone.map((s) => s.id));
      const meetingsPlanned = meetings.filter((m) => sectionIds.has(m.sectionId)).length;
      return { sectionsCloned: toClone.length, meetingsCloned: meetingsPlanned };
    }
    let sectionsCloned = 0;
    let meetingsCloned = 0;
    const sectionIdMap = new Map<string, string>();
    for (const section of sections) {
      const key = `${section.institutionId}|${section.code}`.toLowerCase();
      if (existingKeys.has(key)) continue;
      const newId = randomUUID();
      sectionIdMap.set(section.id, newId);
      await this.repo.createSection({
        ...section,
        id: newId,
        academicPeriodId: targetPeriodId,
        status: 'DRAFT' as SectionPublishStatus,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      sectionsCloned += 1;
    }
    const meetings = await this.repo.listMeetings(tenantId, { academicPeriodId: sourcePeriodId });
    for (const meeting of meetings) {
      const newSectionId = sectionIdMap.get(meeting.sectionId);
      if (!newSectionId) continue;
      await this.repo.createMeeting({
        ...meeting,
        id: randomUUID(),
        sectionId: newSectionId,
        academicPeriodId: targetPeriodId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      meetingsCloned += 1;
    }
    return { sectionsCloned, meetingsCloned };
  }

}

export type { SectionEnrollmentEntity, SubstitutionEntity };
