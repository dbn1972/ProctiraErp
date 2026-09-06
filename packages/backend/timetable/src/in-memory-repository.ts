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

export class InMemoryTimetableRepository implements TimetableRepository {
  private readonly bellSchedules = new Map<string, BellScheduleEntity>();
  private readonly periods = new Map<string, PeriodEntity>();
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

  async listMeetings(tenantId: string, filter?: ListMeetingsFilter) {
    return [...this.meetings.values()].filter((row) => {
      if (row.tenantId !== tenantId) return false;
      if (filter?.institutionId && row.institutionId !== filter.institutionId) return false;
      if (filter?.academicPeriodId && row.academicPeriodId !== filter.academicPeriodId) {
        return false;
      }
      if (filter?.staffId && row.staffId !== filter.staffId) return false;
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
}
