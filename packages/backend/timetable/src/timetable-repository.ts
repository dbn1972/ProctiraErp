/** Timetable repository ports (WS1 — bell schedules, periods, meetings, substitutions). */

export interface BellScheduleEntity {
  id: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  /** Unique per institution + academic period (schema UNIQUE). */
  code: string;
  name: string;
  /** Comma-separated ISO weekdays 1–7, or JSON array string. */
  dayPattern: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PeriodEntity {
  id: string;
  tenantId: string;
  bellScheduleId: string;
  name: string;
  periodOrder: number;
  startTime: string;
  endTime: string;
  createdAt: string;
  updatedAt: string;
}

export interface SectionMeetingEntity {
  id: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  sectionId: string;
  subjectId: string | null;
  staffId: string;
  periodId: string;
  roomId: string | null;
  dayOfWeek: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubstitutionEntity {
  id: string;
  tenantId: string;
  institutionId: string;
  sectionMeetingId: string;
  originalStaffId: string;
  substituteStaffId: string;
  substitutionDate: string;
  reason: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListBellSchedulesFilter {
  institutionId?: string;
  academicPeriodId?: string;
}

export interface ListMeetingsFilter {
  institutionId?: string;
  academicPeriodId?: string;
  staffId?: string;
}

export interface ListSubstitutionsFilter {
  institutionId?: string;
  fromDate?: string;
  toDate?: string;
}

export interface TimetableRepository {
  listBellSchedules(
    tenantId: string,
    filter?: ListBellSchedulesFilter,
  ): Promise<BellScheduleEntity[]>;
  getBellSchedule(tenantId: string, id: string): Promise<BellScheduleEntity | null>;
  createBellSchedule(row: BellScheduleEntity): Promise<BellScheduleEntity>;
  updateBellSchedule(
    tenantId: string,
    id: string,
    patch: Partial<BellScheduleEntity>,
  ): Promise<BellScheduleEntity | null>;
  deleteBellSchedule(tenantId: string, id: string): Promise<boolean>;

  listPeriods(tenantId: string, bellScheduleId: string): Promise<PeriodEntity[]>;
  getPeriod(tenantId: string, id: string): Promise<PeriodEntity | null>;
  createPeriod(row: PeriodEntity): Promise<PeriodEntity>;
  updatePeriod(
    tenantId: string,
    id: string,
    patch: Partial<PeriodEntity>,
  ): Promise<PeriodEntity | null>;
  deletePeriod(tenantId: string, id: string): Promise<boolean>;

  listMeetings(tenantId: string, filter?: ListMeetingsFilter): Promise<SectionMeetingEntity[]>;
  getMeeting(tenantId: string, id: string): Promise<SectionMeetingEntity | null>;
  createMeeting(row: SectionMeetingEntity): Promise<SectionMeetingEntity>;
  updateMeeting(
    tenantId: string,
    id: string,
    patch: Partial<SectionMeetingEntity>,
  ): Promise<SectionMeetingEntity | null>;
  deleteMeeting(tenantId: string, id: string): Promise<boolean>;

  listSubstitutions(
    tenantId: string,
    filter?: ListSubstitutionsFilter,
  ): Promise<SubstitutionEntity[]>;
  getSubstitution(tenantId: string, id: string): Promise<SubstitutionEntity | null>;
  createSubstitution(row: SubstitutionEntity): Promise<SubstitutionEntity>;
}
