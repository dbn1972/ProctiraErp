/** Timetable / master-schedule repository ports (WS1 + WS2). */

export type SectionPublishStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

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

export interface RoomEntity {
  id: string;
  tenantId: string;
  institutionId: string;
  code: string;
  name: string;
  capacity: number;
  roomType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SectionEntity {
  id: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string | null;
  code: string;
  name: string;
  primaryTeacherId: string | null;
  defaultRoomId: string | null;
  capacity: number;
  status: SectionPublishStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SectionEnrollmentEntity {
  id: string;
  tenantId: string;
  sectionId: string;
  studentId: string;
  status: string;
  enrolledAt: string;
  withdrawnAt: string | null;
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

/** Published meeting slot for attendance period pickers. */
export interface AttendancePeriodSlot {
  meetingId: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string;
  periodId: string;
  periodName: string;
  startTime: string;
  endTime: string;
  dayOfWeek: number;
  roomId: string | null;
  teacherStaffId: string | null;
}

export interface ListBellSchedulesFilter {
  institutionId?: string;
  academicPeriodId?: string;
}

export interface ListMeetingsFilter {
  institutionId?: string;
  academicPeriodId?: string;
  staffId?: string;
  sectionId?: string;
}

export interface ListSubstitutionsFilter {
  institutionId?: string;
  fromDate?: string;
  toDate?: string;
}

export interface ListSectionsFilter {
  institutionId?: string;
  academicPeriodId?: string;
  status?: SectionPublishStatus;
}

export interface ListRoomsFilter {
  institutionId?: string;
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

  listRooms(tenantId: string, filter?: ListRoomsFilter): Promise<RoomEntity[]>;
  getRoom(tenantId: string, id: string): Promise<RoomEntity | null>;
  createRoom(row: RoomEntity): Promise<RoomEntity>;

  listSections(tenantId: string, filter?: ListSectionsFilter): Promise<SectionEntity[]>;
  getSection(tenantId: string, id: string): Promise<SectionEntity | null>;
  createSection(row: SectionEntity): Promise<SectionEntity>;
  updateSection(
    tenantId: string,
    id: string,
    patch: Partial<SectionEntity>,
  ): Promise<SectionEntity | null>;
  deleteSection(tenantId: string, id: string): Promise<boolean>;

  listEnrollments(tenantId: string, sectionId: string): Promise<SectionEnrollmentEntity[]>;
  getEnrollment(
    tenantId: string,
    sectionId: string,
    studentId: string,
  ): Promise<SectionEnrollmentEntity | null>;
  createEnrollment(row: SectionEnrollmentEntity): Promise<SectionEnrollmentEntity>;
  updateEnrollment(
    tenantId: string,
    id: string,
    patch: Partial<SectionEnrollmentEntity>,
  ): Promise<SectionEnrollmentEntity | null>;

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

  listAttendancePeriods(
    tenantId: string,
    filter: { institutionId: string; dayOfWeek?: number },
  ): Promise<AttendancePeriodSlot[]>;
}
