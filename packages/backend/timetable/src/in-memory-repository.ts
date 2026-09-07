import type {
  AttendancePeriodSlot,
  BellScheduleEntity,
  PeriodEntity,
  RoomEntity,
  SectionEnrollmentEntity,
  SectionEntity,
  SectionMeetingEntity,
  SubstitutionEntity,
  TimetableRepository,
  ListBellSchedulesFilter,
  ListMeetingsFilter,
  ListRoomsFilter,
  ListSectionsFilter,
  ListSubstitutionsFilter,
} from './timetable-repository.js';

export class InMemoryTimetableRepository implements TimetableRepository {
  private readonly bellSchedules = new Map<string, BellScheduleEntity>();
  private readonly periods = new Map<string, PeriodEntity>();
  private readonly rooms = new Map<string, RoomEntity>();
  private readonly sections = new Map<string, SectionEntity>();
  private readonly enrollments = new Map<string, SectionEnrollmentEntity>();
  private readonly meetings = new Map<string, SectionMeetingEntity>();
  private readonly substitutions = new Map<string, SubstitutionEntity>();

  async listBellSchedules(tenantId: string, filter?: ListBellSchedulesFilter) {
    return [...this.bellSchedules.values()].filter((row) => {
      if (row.tenantId !== tenantId) return false;
      if (filter?.institutionId && row.institutionId !== filter.institutionId) return false;
      if (filter?.academicPeriodId && row.academicPeriodId !== filter.academicPeriodId) {
        return false;
      }
      return true;
    });
  }

  async getBellSchedule(tenantId: string, id: string) {
    const row = this.bellSchedules.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async createBellSchedule(row: BellScheduleEntity) {
    this.bellSchedules.set(row.id, {
      ...row,
      code: row.code || row.name.slice(0, 32).toUpperCase().replace(/\s+/g, '_'),
    });
    return this.bellSchedules.get(row.id)!;
  }

  async updateBellSchedule(tenantId: string, id: string, patch: Partial<BellScheduleEntity>) {
    const cur = await this.getBellSchedule(tenantId, id);
    if (!cur) return null;
    const next = {
      ...cur,
      ...patch,
      id: cur.id,
      tenantId: cur.tenantId,
      updatedAt: new Date().toISOString(),
    };
    this.bellSchedules.set(id, next);
    return next;
  }

  async deleteBellSchedule(tenantId: string, id: string) {
    const cur = await this.getBellSchedule(tenantId, id);
    if (!cur) return false;
    for (const [periodId, period] of this.periods) {
      if (period.bellScheduleId === id && period.tenantId === tenantId) {
        this.periods.delete(periodId);
      }
    }
    this.bellSchedules.delete(id);
    return true;
  }

  async listPeriods(tenantId: string, bellScheduleId: string) {
    return [...this.periods.values()]
      .filter((p) => p.tenantId === tenantId && p.bellScheduleId === bellScheduleId)
      .sort((a, b) => a.periodOrder - b.periodOrder);
  }

  async getPeriod(tenantId: string, id: string) {
    const row = this.periods.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async createPeriod(row: PeriodEntity) {
    this.periods.set(row.id, row);
    return row;
  }

  async updatePeriod(tenantId: string, id: string, patch: Partial<PeriodEntity>) {
    const cur = await this.getPeriod(tenantId, id);
    if (!cur) return null;
    const next = {
      ...cur,
      ...patch,
      id: cur.id,
      tenantId: cur.tenantId,
      updatedAt: new Date().toISOString(),
    };
    this.periods.set(id, next);
    return next;
  }

  async deletePeriod(tenantId: string, id: string) {
    const cur = await this.getPeriod(tenantId, id);
    if (!cur) return false;
    this.periods.delete(id);
    return true;
  }

  async listRooms(tenantId: string, filter?: ListRoomsFilter) {
    return [...this.rooms.values()].filter((row) => {
      if (row.tenantId !== tenantId) return false;
      if (filter?.institutionId && row.institutionId !== filter.institutionId) return false;
      return true;
    });
  }

  async getRoom(tenantId: string, id: string) {
    const row = this.rooms.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async createRoom(row: RoomEntity) {
    this.rooms.set(row.id, row);
    return row;
  }

  async listSections(tenantId: string, filter?: ListSectionsFilter) {
    return [...this.sections.values()].filter((row) => {
      if (row.tenantId !== tenantId) return false;
      if (filter?.institutionId && row.institutionId !== filter.institutionId) return false;
      if (filter?.academicPeriodId && row.academicPeriodId !== filter.academicPeriodId) {
        return false;
      }
      if (filter?.status && row.status !== filter.status) return false;
      return true;
    });
  }

  async getSection(tenantId: string, id: string) {
    const row = this.sections.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async createSection(row: SectionEntity) {
    this.sections.set(row.id, row);
    return row;
  }

  async updateSection(tenantId: string, id: string, patch: Partial<SectionEntity>) {
    const cur = await this.getSection(tenantId, id);
    if (!cur) return null;
    const next = {
      ...cur,
      ...patch,
      id: cur.id,
      tenantId: cur.tenantId,
      updatedAt: new Date().toISOString(),
    };
    this.sections.set(id, next);
    return next;
  }

  async deleteSection(tenantId: string, id: string) {
    const cur = await this.getSection(tenantId, id);
    if (!cur) return false;
    for (const [eid, e] of this.enrollments) {
      if (e.sectionId === id && e.tenantId === tenantId) this.enrollments.delete(eid);
    }
    for (const [mid, m] of this.meetings) {
      if (m.sectionId === id && m.tenantId === tenantId) this.meetings.delete(mid);
    }
    this.sections.delete(id);
    return true;
  }

  async listEnrollments(tenantId: string, sectionId: string) {
    return [...this.enrollments.values()].filter(
      (e) => e.tenantId === tenantId && e.sectionId === sectionId,
    );
  }

  async getEnrollment(tenantId: string, sectionId: string, studentId: string) {
    return (
      [...this.enrollments.values()].find(
        (e) =>
          e.tenantId === tenantId && e.sectionId === sectionId && e.studentId === studentId,
      ) ?? null
    );
  }

  async createEnrollment(row: SectionEnrollmentEntity) {
    this.enrollments.set(row.id, row);
    return row;
  }

  async updateEnrollment(
    tenantId: string,
    id: string,
    patch: Partial<SectionEnrollmentEntity>,
  ) {
    const cur = this.enrollments.get(id);
    if (!cur || cur.tenantId !== tenantId) return null;
    const next = {
      ...cur,
      ...patch,
      id: cur.id,
      tenantId: cur.tenantId,
      updatedAt: new Date().toISOString(),
    };
    this.enrollments.set(id, next);
    return next;
  }

  async listMeetings(tenantId: string, filter?: ListMeetingsFilter) {
    return [...this.meetings.values()].filter((row) => {
      if (row.tenantId !== tenantId) return false;
      if (filter?.institutionId && row.institutionId !== filter.institutionId) return false;
      if (filter?.academicPeriodId && row.academicPeriodId !== filter.academicPeriodId) {
        return false;
      }
      if (filter?.staffId && row.staffId !== filter.staffId) return false;
      if (filter?.sectionId && row.sectionId !== filter.sectionId) return false;
      return true;
    });
  }

  async getMeeting(tenantId: string, id: string) {
    const row = this.meetings.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async createMeeting(row: SectionMeetingEntity) {
    this.meetings.set(row.id, row);
    return row;
  }

  async updateMeeting(tenantId: string, id: string, patch: Partial<SectionMeetingEntity>) {
    const cur = await this.getMeeting(tenantId, id);
    if (!cur) return null;
    const next = {
      ...cur,
      ...patch,
      id: cur.id,
      tenantId: cur.tenantId,
      updatedAt: new Date().toISOString(),
    };
    this.meetings.set(id, next);
    return next;
  }

  async deleteMeeting(tenantId: string, id: string) {
    const cur = await this.getMeeting(tenantId, id);
    if (!cur) return false;
    this.meetings.delete(id);
    return true;
  }

  async listSubstitutions(tenantId: string, filter?: ListSubstitutionsFilter) {
    return [...this.substitutions.values()].filter((row) => {
      if (row.tenantId !== tenantId) return false;
      if (filter?.institutionId && row.institutionId !== filter.institutionId) return false;
      if (filter?.fromDate && row.substitutionDate < filter.fromDate) return false;
      if (filter?.toDate && row.substitutionDate > filter.toDate) return false;
      return true;
    });
  }

  async getSubstitution(tenantId: string, id: string) {
    const row = this.substitutions.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async createSubstitution(row: SubstitutionEntity) {
    this.substitutions.set(row.id, row);
    return row;
  }

  async listAttendancePeriods(
    tenantId: string,
    filter: { institutionId: string; dayOfWeek?: number },
  ): Promise<AttendancePeriodSlot[]> {
    const published = await this.listSections(tenantId, {
      institutionId: filter.institutionId,
      status: 'PUBLISHED',
    });
    const sectionById = new Map(published.map((s) => [s.id, s]));
    const slots: AttendancePeriodSlot[] = [];
    for (const meeting of await this.listMeetings(tenantId, {
      institutionId: filter.institutionId,
    })) {
      const section = sectionById.get(meeting.sectionId);
      if (!section) continue;
      if (filter.dayOfWeek != null && meeting.dayOfWeek !== filter.dayOfWeek) continue;
      const period = await this.getPeriod(tenantId, meeting.periodId);
      slots.push({
        meetingId: meeting.id,
        sectionId: section.id,
        sectionCode: section.code,
        sectionName: section.name,
        periodId: meeting.periodId,
        periodName: period?.name ?? meeting.periodId,
        startTime: period?.startTime ?? '',
        endTime: period?.endTime ?? '',
        dayOfWeek: meeting.dayOfWeek,
        roomId: meeting.roomId,
        teacherStaffId: meeting.staffId || null,
      });
    }
    return slots.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  }
}
