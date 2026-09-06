import { randomUUID } from 'node:crypto';

import { NotFoundError, ValidationError } from '@proctira/common';

import { detectMeetingClashes, detectSubstituteClashes } from './clash-helper.js';
import { TimetableClashError } from './timetable-errors.js';
import type {
  BellScheduleEntity,
  PeriodEntity,
  SectionMeetingEntity,
  SubstitutionEntity,
  TimetableRepository,
  ListBellSchedulesFilter,
  ListMeetingsFilter,
  ListSubstitutionsFilter,
} from './timetable-repository.js';

type BellScheduleInput = Omit<
  BellScheduleEntity,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt' | 'code'
> & { code?: string };
type PeriodInput = Omit<PeriodEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
type MeetingInput = Omit<SectionMeetingEntity, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>;
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
    const code =
      input.code?.trim() ||
      input.name
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 40) ||
      'BELL';
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

  listMeetings(tenantId: string, filter?: ListMeetingsFilter) {
    return this.repo.listMeetings(tenantId, filter);
  }

  getMeeting(tenantId: string, id: string) {
    return this.repo.getMeeting(tenantId, id);
  }

  async createMeeting(tenantId: string, input: MeetingInput) {
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

  deleteMeeting(tenantId: string, id: string) {
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

    // Enrich substitutions with period/day from their meetings for clash helper.
    const meetingById = new Map(meetings.map((m) => [m.id, m]));
    const enrichedSubs = [];
    for (const sub of substitutions) {
      const linked = meetingById.get(sub.sectionMeetingId) ?? (await this.repo.getMeeting(tenantId, sub.sectionMeetingId));
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
