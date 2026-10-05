import { randomUUID } from 'node:crypto';

import { AppError, ConflictError, NotFoundError, ValidationError } from '@proctira/common';

import {
  detectMeetingClashes,
  detectSubstituteClashes,
  type PeriodWindow,
} from './clash-helper.js';
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
import { isValidIsoDate } from './schemas.js';
import type { CreateGenerationJobInput, CreateTeacherAbsenceInput } from './schemas.js';
import {
  isTimetableClashError,
  TimetableClashError,
  TimetableVersionConflictError,
} from './timetable-errors.js';
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
  UpdateConcurrencyOpts,
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

/** PRC-M401: a queued/running generation older than this is treated as crashed. */
const GENERATION_STALE_MS = 15 * 60 * 1000;
const GENERATION_STALE_MESSAGE = 'Generation interrupted (worker stopped); re-run the job';
/** PRC-M401: per-process cap on concurrent solver runs (CPU-bound). */
const DEFAULT_GENERATION_CONCURRENCY = 2;

/** Client-safe failure text: domain validation messages pass through, internals do not. */
function sanitizeGenerationError(error: unknown): string {
  if (error instanceof AppError && error.statusCode < 500) return error.message;
  return 'Generation failed due to an internal error';
}

function nowIso(): string {
  return new Date().toISOString();
}

/** PRC-M403: calendar date (YYYY-MM-DD) of `instant` in an IANA timezone. */
export function calendarDateInZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Resolves the institution/tenant IANA timezone used for enrollment calendar dates. */
export type TimetableTimeZoneResolver = (
  tenantId: string,
  institutionId?: string,
) => string | Promise<string>;

export interface TimetableServiceOptions {
  maxConcurrentGenerations?: number;
  /** Default 'UTC' (or TIMETABLE_DEFAULT_TIMEZONE). */
  timeZone?: string | TimetableTimeZoneResolver;
  /** Injectable clock for tests. */
  now?: () => Date;
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

  private runningGenerations = 0;
  private readonly maxConcurrentGenerations: number;

  constructor(
    private readonly repo: TimetableRepository,
    ops?: TimetableOpsStore,
    private readonly options: TimetableServiceOptions = {},
  ) {
    this.ops = ops ?? new InMemoryTimetableOpsStore();
    const envCap = Number(process.env.TIMETABLE_GENERATION_MAX_CONCURRENCY);
    this.maxConcurrentGenerations = Math.max(
      1,
      options.maxConcurrentGenerations ??
        (Number.isInteger(envCap) && envCap > 0 ? envCap : DEFAULT_GENERATION_CONCURRENCY),
    );
  }

  private async localDate(tenantId: string, institutionId?: string): Promise<string> {
    const configured = this.options.timeZone;
    let zone =
      typeof configured === 'function'
        ? await configured(tenantId, institutionId)
        : (configured ?? process.env.TIMETABLE_DEFAULT_TIMEZONE ?? 'UTC');
    try {
      Intl.DateTimeFormat('en-CA', { timeZone: zone });
    } catch {
      zone = 'UTC';
    }
    return calendarDateInZone(this.options.now?.() ?? new Date(), zone);
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

  async updateBellSchedule(
    tenantId: string,
    id: string,
    patch: Partial<BellScheduleInput>,
    opts?: UpdateConcurrencyOpts,
  ) {
    await this.assertBellScheduleUnlocked(tenantId, id);
    const row = await this.repo.updateBellSchedule(tenantId, id, patch, opts);
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
    await this.assertBellScheduleUnlocked(tenantId, id);
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
    await this.assertNoPeriodOverlap(tenantId, input.bellScheduleId, input);
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

  /** PRC-M399: periods of one bell schedule must not overlap in time. */
  private async assertNoPeriodOverlap(
    tenantId: string,
    bellScheduleId: string,
    candidate: { startTime: string; endTime: string },
    excludePeriodId?: string,
  ): Promise<void> {
    const siblings = await this.repo.listPeriods(tenantId, bellScheduleId);
    const clash = siblings.find(
      (p) =>
        p.id !== excludePeriodId &&
        candidate.startTime < p.endTime.slice(0, 5) &&
        p.startTime.slice(0, 5) < candidate.endTime,
    );
    if (clash) {
      throw new ValidationError(
        `Period ${candidate.startTime}-${candidate.endTime} overlaps period ${clash.name}`,
      );
    }
  }

  async updatePeriod(
    tenantId: string,
    id: string,
    patch: Partial<PeriodInput>,
    opts?: UpdateConcurrencyOpts,
  ) {
    const existing = await this.repo.getPeriod(tenantId, id);
    if (!existing) return null;
    await this.assertPeriodsUnlocked(tenantId, existing.bellScheduleId, [id]);
    // PRC-M399: validate the merged row, not just the patch.
    const merged = {
      startTime: (patch.startTime ?? existing.startTime).slice(0, 5),
      endTime: (patch.endTime ?? existing.endTime).slice(0, 5),
    };
    if (merged.startTime >= merged.endTime) {
      throw new ValidationError('Period startTime must be before endTime');
    }
    if (patch.startTime !== undefined || patch.endTime !== undefined) {
      await this.assertNoPeriodOverlap(tenantId, existing.bellScheduleId, merged, id);
    }
    const row = await this.repo.updatePeriod(tenantId, id, patch, opts);
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
    const existing = await this.repo.getPeriod(tenantId, id);
    if (!existing) return false;
    await this.assertPeriodsUnlocked(tenantId, existing.bellScheduleId, [id]);
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

  async updateSection(
    tenantId: string,
    id: string,
    patch: Partial<SectionInput>,
    opts?: UpdateConcurrencyOpts,
  ) {
    const existing = await this.repo.getSection(tenantId, id);
    if (!existing) return null;
    if (existing.status === 'PUBLISHED') {
      throw new ValidationError('Published sections are locked; unpublish before editing');
    }
    return this.repo.updateSection(tenantId, id, patch, opts);
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
    // PRC-M403: capacity check + write are one atomic repository operation.
    const result = await this.repo.enrollWithinCapacity({
      tenantId,
      sectionId,
      studentId,
      enrolledAt: await this.localDate(tenantId, section.institutionId),
      newId: randomUUID(),
      now: nowIso(),
    });
    switch (result.outcome) {
      case 'enrolled':
      case 'already_enrolled':
        return result.enrollment;
      case 'section_missing':
        throw new NotFoundError(`Section ${sectionId} not found`);
      case 'student_missing':
        throw new NotFoundError(`Student ${studentId} not found`);
      case 'section_archived':
        throw new ValidationError('Cannot enroll into an archived section');
      case 'full':
        throw new ValidationError(`Section ${result.code} is at capacity (${result.capacity})`);
    }
  }

  async withdrawStudent(tenantId: string, sectionId: string, studentId: string) {
    const enrollment = await this.repo.getEnrollment(tenantId, sectionId, studentId);
    if (!enrollment) {
      throw new NotFoundError(`Enrollment for student ${studentId} not found`);
    }
    if (enrollment.status === 'WITHDRAWN') {
      return enrollment;
    }
    const section = await this.repo.getSection(tenantId, sectionId);
    return this.repo.updateEnrollment(tenantId, enrollment.id, {
      status: 'WITHDRAWN',
      withdrawnAt: await this.localDate(tenantId, section?.institutionId),
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

    const periodTimes = await this.loadPeriodTimes(
      tenantId,
      meetings.map((m) => m.periodId),
    );
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
      const conflicts = detectMeetingClashes(meetings, candidate, candidate.id, periodTimes);
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
  async publishSection(
    tenantId: string,
    sectionId: string,
    opts?: UpdateConcurrencyOpts,
  ): Promise<SectionEntity> {
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
    const periodTimes = await this.loadPeriodTimes(
      tenantId,
      meetings.map((m) => m.periodId),
    );
    for (const candidate of sectionMeetings) {
      const conflicts = detectMeetingClashes(meetings, candidate, candidate.id, periodTimes);
      const hard = conflicts.filter((c) => c.reason === 'staff' || c.reason === 'room');
      if (hard.length > 0) {
        throw new TimetableClashError(
          `Cannot publish section ${section.code}: ${hard.map((c) => c.reason).join(', ')} clash`,
          hard,
        );
      }
    }

    if (opts?.expectedUpdatedAt && opts.expectedUpdatedAt !== section.updatedAt) {
      throw new TimetableVersionConflictError('section', sectionId, section.updatedAt);
    }
    // PRC-M404: CAS on the version read before the clash check — a concurrent section edit
    // between check and write makes this a 409 instead of publishing a stale state.
    const updated = await this.repo.updateSection(
      tenantId,
      sectionId,
      { status: 'PUBLISHED', publishedAt: nowIso() },
      { expectedUpdatedAt: section.updatedAt },
    );
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

  async unpublishSection(
    tenantId: string,
    sectionId: string,
    opts?: UpdateConcurrencyOpts,
  ): Promise<SectionEntity> {
    const section = await this.repo.getSection(tenantId, sectionId);
    if (!section) {
      throw new NotFoundError(`Section ${sectionId} not found`);
    }
    if (section.status === 'DRAFT') {
      return section;
    }
    if (opts?.expectedUpdatedAt && opts.expectedUpdatedAt !== section.updatedAt) {
      throw new TimetableVersionConflictError('section', sectionId, section.updatedAt);
    }
    const updated = await this.repo.updateSection(
      tenantId,
      sectionId,
      { status: 'DRAFT', publishedAt: null },
      { expectedUpdatedAt: section.updatedAt },
    );
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

  async updateMeeting(
    tenantId: string,
    id: string,
    patch: Partial<MeetingInput>,
    opts?: UpdateConcurrencyOpts,
  ) {
    const existing = await this.repo.getMeeting(tenantId, id);
    if (!existing) return null;
    // PRC-M405: moving a meeting must not touch a locked schedule on either side.
    await this.assertSectionEditable(tenantId, existing.sectionId);
    if (patch.sectionId && patch.sectionId !== existing.sectionId) {
      await this.assertSectionEditable(tenantId, patch.sectionId);
    }
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
    const row = await this.repo.updateMeeting(tenantId, id, patch, opts);
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

    // PRC-M402: provenance comes from the meeting, never from the client.
    if (input.originalStaffId !== undefined && input.originalStaffId !== meeting.staffId) {
      throw new ValidationError('originalStaffId does not match the meeting teacher');
    }
    if (input.institutionId !== undefined && input.institutionId !== meeting.institutionId) {
      throw new ValidationError('institutionId does not match the meeting institution');
    }
    const originalStaffId = meeting.staffId;
    const institutionId = meeting.institutionId;
    if (!isValidIsoDate(input.substitutionDate)) {
      throw new ValidationError('substitutionDate must be a real YYYY-MM-DD date');
    }
    if (isoWeekday(input.substitutionDate) !== meeting.dayOfWeek) {
      throw new ValidationError(
        `substitutionDate ${input.substitutionDate} is not on the meeting weekday (${meeting.dayOfWeek})`,
      );
    }
    if (meeting.status !== 'active') {
      throw new ValidationError('Cannot substitute an inactive or cancelled meeting');
    }
    const substituteAbsences = await this.ops.listAbsences(tenantId, {
      institutionId,
      staffId: input.substituteStaffId,
      date: input.substitutionDate,
    });
    if (substituteAbsences.length > 0) {
      throw new ValidationError('Substitute teacher is marked absent on that date');
    }

    if (originalStaffId === input.substituteStaffId) {
      throw new ValidationError('Substitute staff must differ from the original teacher');
    }

    const meetings = await this.repo.listMeetings(tenantId, {
      institutionId,
      academicPeriodId: meeting.academicPeriodId,
      dayOfWeek: meeting.dayOfWeek,
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

    const periodTimes = await this.loadPeriodTimes(tenantId, [
      meeting.periodId,
      ...meetings.filter((m) => m.dayOfWeek === meeting.dayOfWeek).map((m) => m.periodId),
      ...enrichedSubs.map((sub) => sub.periodId),
    ]);
    const conflicts = detectSubstituteClashes({
      substituteStaffId: input.substituteStaffId,
      periodId: meeting.periodId,
      dayOfWeek: meeting.dayOfWeek,
      substitutionDate: input.substitutionDate,
      // PRC-M398: only the meeting's academic period can collide.
      meetings: meetings.filter((m) => m.academicPeriodId === meeting.academicPeriodId),
      substitutions: enrichedSubs,
      periodTimes,
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

  /** PRC-M401: sweeps crashed runs, then returns a bounded summary page (no blobs). */
  async listGenerationJobs(
    tenantId: string,
    filter: { institutionId?: string; limit?: number; offset?: number },
  ) {
    await this.sweepStaleGenerationJobs(tenantId);
    return this.ops.listJobs(tenantId, filter);
  }

  async sweepStaleGenerationJobs(tenantId: string, now: number = Date.now()): Promise<number> {
    return this.ops.failStaleJobs(
      tenantId,
      new Date(now - GENERATION_STALE_MS).toISOString(),
      GENERATION_STALE_MESSAGE,
    );
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
    options: { async?: boolean } = {},
  ): Promise<GenerationJobRecord> {
    if (this.runningGenerations >= this.maxConcurrentGenerations) {
      throw new AppError(
        'Too many timetable generations are running; retry shortly',
        'TOO_MANY_REQUESTS',
        429,
      );
    }
    await this.sweepStaleGenerationJobs(tenantId);
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

    this.runningGenerations += 1;
    if (options.async) {
      // PRC-M401: off the request path; the stale sweeper fails it if the process dies.
      setImmediate(() => {
        void this.executeGenerationJob(tenantId, job, input, requestedBy).catch(() => undefined);
      });
      return job;
    }
    return this.executeGenerationJob(tenantId, job, input, requestedBy);
  }

  private async executeGenerationJob(
    tenantId: string,
    job: GenerationJobRecord,
    input: CreateGenerationJobInput,
    requestedBy: string | null,
  ): Promise<GenerationJobRecord> {
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
        demands: input.demands.map((d): GeneratorDemand => ({
          id: d.id ?? randomUUID(),
          sectionId: d.sectionId,
          subjectId: d.subjectId,
          staffId: d.staffId,
          periodsPerWeek: d.periodsPerWeek,
          preferredRoomId: d.preferredRoomId ?? null,
          enrollmentCount: d.enrollmentCount ?? 0,
        })),
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
      const failed = await this.ops.updateJob(tenantId, job.id, {
        status: 'failed',
        errorMessage: sanitizeGenerationError(error),
        finishedAt: nowIso(),
      });
      if (failed) return failed;
      throw error;
    } finally {
      this.runningGenerations -= 1;
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
      return rows
        .filter((p) => !p.isBreak && !/^break$/i.test(p.name))
        .map((p) => ({
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
    return rows
      .filter((p) => !p.isBreak && !/^break$/i.test(p.name))
      .map((p) => ({
        id: p.id,
        startTime: p.startTime,
        endTime: p.endTime,
        periodOrder: p.periodOrder,
      }));
  }

  /**
   * PRC-M405: periods referenced by meetings of a PUBLISHED section are part of a locked
   * schedule; editing/deleting them would silently change the published timetable.
   */
  private async assertPeriodsUnlocked(
    tenantId: string,
    bellScheduleId: string,
    periodIds: readonly string[],
  ): Promise<void> {
    if (periodIds.length === 0) return;
    const schedule = await this.repo.getBellSchedule(tenantId, bellScheduleId);
    const ids = new Set(periodIds);
    const meetings = await this.repo.listMeetings(
      tenantId,
      schedule ? { institutionId: schedule.institutionId } : undefined,
    );
    const sectionIds = new Set(
      meetings
        .filter((m) => ids.has(m.periodId) && m.status !== 'cancelled')
        .map((m) => m.sectionId),
    );
    for (const sectionId of sectionIds) {
      const section = await this.repo.getSection(tenantId, sectionId);
      if (section?.status === 'PUBLISHED') {
        throw new ConflictError(
          `Period is used by published section ${section.code}; unpublish before editing`,
        );
      }
    }
  }

  private async assertBellScheduleUnlocked(tenantId: string, bellScheduleId: string) {
    const periods = await this.repo.listPeriods(tenantId, bellScheduleId);
    await this.assertPeriodsUnlocked(
      tenantId,
      bellScheduleId,
      periods.map((p) => p.id),
    );
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

  /** PRC-M398: wall-clock windows for every period referenced, for time-overlap clash checks. */
  private async loadPeriodTimes(
    tenantId: string,
    periodIds: Iterable<string>,
  ): Promise<Map<string, PeriodWindow>> {
    const out = new Map<string, PeriodWindow>();
    for (const id of new Set(periodIds)) {
      const period = await this.repo.getPeriod(tenantId, id);
      if (period) out.set(id, { startTime: period.startTime, endTime: period.endTime });
    }
    return out;
  }

  private async assertNoMeetingClash(
    tenantId: string,
    candidate: MeetingInput,
    excludeMeetingId?: string,
  ): Promise<void> {
    // PRC-M398: only meetings of the same academic period can collide.
    // PRC-M407: fetch only candidate-relevant rows (same institution, period and weekday).
    const sameDay = await this.repo.listMeetings(tenantId, {
      institutionId: candidate.institutionId,
      academicPeriodId: candidate.academicPeriodId,
      dayOfWeek: candidate.dayOfWeek,
    });
    const periodTimes = await this.loadPeriodTimes(tenantId, [
      candidate.periodId,
      ...sameDay.map((m) => m.periodId),
    ]);
    const conflicts = detectMeetingClashes(sameDay, candidate, excludeMeetingId, periodTimes);
    if (conflicts.length > 0) {
      const reasons = [...new Set(conflicts.map((c) => c.reason))].join(', ');
      throw new TimetableClashError(
        `Timetable clash on day ${candidate.dayOfWeek} period ${candidate.periodId} (${reasons})`,
        conflicts,
      );
    }
  }
  /**
   * G-5 — clone sections + meetings into a target academic period.
   *
   * PRC-M397:
   * - meetings are remapped onto the TARGET period's bell schedule (same
   *   schedule code, else the institution's only target schedule) by
   *   `periodOrder`; any unmappable meeting fails the whole clone;
   * - cloned sections are DRAFT with `publishedAt` cleared;
   * - clash validation runs against target-period meetings + the plan;
   * - all rows are written in one repository transaction (all-or-nothing);
   * - resume-safe: target sections that already exist but have no meetings
   *   receive their meetings;
   * - an audit entry is recorded.
   */
  async cloneForAcademicPeriod(
    tenantId: string,
    sourcePeriodId: string,
    targetPeriodId: string,
    options: { dryRun?: boolean; actorId?: string | null } = {},
  ): Promise<{ sectionsCloned: number; meetingsCloned: number }> {
    if (sourcePeriodId === targetPeriodId) {
      throw new ValidationError('Source and target academic periods must differ');
    }
    const sections = await this.repo.listSections(tenantId, { academicPeriodId: sourcePeriodId });
    const existingTarget = await this.repo.listSections(tenantId, {
      academicPeriodId: targetPeriodId,
    });
    const keyOf = (s: SectionEntity) => `${s.institutionId}|${s.code}`.toLowerCase();
    const targetByKey = new Map(existingTarget.map((s) => [keyOf(s), s]));
    const targetMeetings = await this.repo.listMeetings(tenantId, {
      academicPeriodId: targetPeriodId,
    });
    const targetSectionsWithMeetings = new Set(targetMeetings.map((m) => m.sectionId));

    const now = nowIso();
    const newSections: SectionEntity[] = [];
    /** source section id -> target section id (new, or existing-but-empty for resume). */
    const sectionIdMap = new Map<string, string>();
    for (const section of sections) {
      const existing = targetByKey.get(keyOf(section));
      if (existing) {
        if (!targetSectionsWithMeetings.has(existing.id)) sectionIdMap.set(section.id, existing.id);
        continue;
      }
      const newId = randomUUID();
      sectionIdMap.set(section.id, newId);
      newSections.push({
        ...section,
        id: newId,
        academicPeriodId: targetPeriodId,
        status: 'DRAFT' as SectionPublishStatus,
        publishedAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    const sourceMeetings = (
      await this.repo.listMeetings(tenantId, { academicPeriodId: sourcePeriodId })
    ).filter((m) => sectionIdMap.has(m.sectionId));
    const mapPeriod = await this.buildPeriodMapper(tenantId, targetPeriodId);
    const unmapped: string[] = [];
    const newMeetings: SectionMeetingEntity[] = [];
    for (const meeting of sourceMeetings) {
      const periodId = await mapPeriod(meeting.institutionId, meeting.periodId);
      if (!periodId) {
        unmapped.push(meeting.id);
        continue;
      }
      newMeetings.push({
        ...meeting,
        id: randomUUID(),
        sectionId: sectionIdMap.get(meeting.sectionId)!,
        academicPeriodId: targetPeriodId,
        periodId,
        createdAt: now,
        updatedAt: now,
      });
    }
    if (unmapped.length > 0) {
      throw new ValidationError(
        `${unmapped.length} meeting(s) cannot be mapped to a bell period of the target academic period; create the target bell schedule (same code and period orders) first`,
      );
    }

    // Clash validation against what already exists in the target + the plan.
    const accumulated: SectionMeetingEntity[] = [...targetMeetings];
    for (const candidate of newMeetings) {
      const conflicts = detectMeetingClashes(
        accumulated.filter((m) => m.institutionId === candidate.institutionId),
        candidate,
      );
      if (conflicts.length > 0) {
        const reasons = [...new Set(conflicts.map((c) => c.reason))].join(', ');
        throw new TimetableClashError(
          `Cloned timetable clash on day ${candidate.dayOfWeek} period ${candidate.periodId} (${reasons})`,
          conflicts,
        );
      }
      accumulated.push(candidate);
    }

    const result = { sectionsCloned: newSections.length, meetingsCloned: newMeetings.length };
    if (options.dryRun) return result;

    await this.repo.insertClonedTimetable(tenantId, newSections, newMeetings);
    this.recordAudit({
      tenantId,
      action: 'timetable.clone_period',
      entityType: 'academic_period',
      entityId: targetPeriodId,
      actorId: options.actorId ?? null,
      details: { sourcePeriodId, targetPeriodId, ...result },
    });
    return result;
  }

  /**
   * PRC-M397: resolve a source bell period to the target academic period's
   * bell period with the same `periodOrder`. Target schedule = same code as
   * the source schedule, else the institution's only target schedule.
   */
  private async buildPeriodMapper(
    tenantId: string,
    targetPeriodId: string,
  ): Promise<(institutionId: string, sourcePeriodId: string) => Promise<string | null>> {
    const cache = new Map<string, string | null>();
    const targetSchedules = new Map<string, BellScheduleEntity[]>();
    const targetPeriods = new Map<string, PeriodEntity[]>();
    return async (institutionId, sourcePeriodId) => {
      const cacheKey = `${institutionId}|${sourcePeriodId}`;
      if (cache.has(cacheKey)) return cache.get(cacheKey)!;
      let mapped: string | null = null;
      const period = await this.repo.getPeriod(tenantId, sourcePeriodId);
      const sourceSchedule = period
        ? await this.repo.getBellSchedule(tenantId, period.bellScheduleId)
        : null;
      if (period && sourceSchedule) {
        if (!targetSchedules.has(institutionId)) {
          targetSchedules.set(
            institutionId,
            await this.repo.listBellSchedules(tenantId, {
              institutionId,
              academicPeriodId: targetPeriodId,
            }),
          );
        }
        const candidates = targetSchedules.get(institutionId)!;
        const schedule =
          candidates.find((c) => c.code.toLowerCase() === sourceSchedule.code.toLowerCase()) ??
          (candidates.length === 1 ? candidates[0] : undefined);
        if (schedule) {
          if (!targetPeriods.has(schedule.id)) {
            targetPeriods.set(schedule.id, await this.repo.listPeriods(tenantId, schedule.id));
          }
          mapped =
            targetPeriods.get(schedule.id)!.find((p) => p.periodOrder === period.periodOrder)?.id ??
            null;
        }
      }
      cache.set(cacheKey, mapped);
      return mapped;
    };
  }
}

export type { SectionEnrollmentEntity, SubstitutionEntity };
