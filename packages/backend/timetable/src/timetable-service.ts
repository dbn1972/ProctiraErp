import { randomUUID } from 'node:crypto';

import { NotFoundError, ValidationError } from '@proctira/common';

import { detectMeetingClashes, detectSubstituteClashes } from './clash-helper.js';
import { TimetableClashError } from './timetable-errors.js';
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

export class TimetableService {
  constructor(private readonly repo: TimetableRepository) {}

  listBellSchedules(tenantId: string, filter?: ListBellSchedulesFilter) {
    return this.repo.listBellSchedules(tenantId, filter);
  }

  getBellSchedule(tenantId: string, id: string) {
    return this.repo.getBellSchedule(tenantId, id);
  }

  createBellSchedule(tenantId: string, input: BellScheduleInput) {
    const now = nowIso();
    const code = input.code?.trim() || slugCode(input.name, 'BELL');
    return this.repo.createBellSchedule({
      id: randomUUID(),
      tenantId,
      ...input,
      code,
      dayPattern: input.dayPattern ?? '1,2,3,4,5',
      status: input.status ?? 'active',
      createdAt: now,
      updatedAt: now,
    });
  }

  updateBellSchedule(tenantId: string, id: string, patch: Partial<BellScheduleInput>) {
    return this.repo.updateBellSchedule(tenantId, id, patch);
  }

  deleteBellSchedule(tenantId: string, id: string) {
    return this.repo.deleteBellSchedule(tenantId, id);
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
    return this.repo.createPeriod({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    });
  }

  updatePeriod(tenantId: string, id: string, patch: Partial<PeriodInput>) {
    return this.repo.updatePeriod(tenantId, id, patch);
  }

  deletePeriod(tenantId: string, id: string) {
    return this.repo.deletePeriod(tenantId, id);
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
    return this.repo.createMeeting({
      id: randomUUID(),
      tenantId,
      ...input,
      createdAt: now,
      updatedAt: now,
    });
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
    return this.repo.updateMeeting(tenantId, id, patch);
  }

  async deleteMeeting(tenantId: string, id: string) {
    const existing = await this.repo.getMeeting(tenantId, id);
    if (!existing) return false;
    await this.assertSectionEditable(tenantId, existing.sectionId);
    return this.repo.deleteMeeting(tenantId, id);
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
    return this.repo.createSubstitution({
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
  }

  listAttendancePeriods(
    tenantId: string,
    filter: { institutionId: string; dayOfWeek?: number },
  ) {
    return this.repo.listAttendancePeriods(tenantId, filter);
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
}

export type { SectionEnrollmentEntity, SubstitutionEntity };
