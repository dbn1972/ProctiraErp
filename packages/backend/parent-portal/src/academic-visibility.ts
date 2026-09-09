/**
 * Parent/student academic visibility — read models aggregated from domain tables.
 *
 * Assumption (student self-binding): `students` has no `user_id` column. A student
 * JWT is bound to a row by `custom_data.user_id` / `custom_data.email`, and when
 * those are absent the JWT `sub` is treated as `students.id` if it is a UUID.
 */

export const STUDENT_SELF_BINDING_ASSUMPTION =
  'students has no user_id column; resolve via custom_data.user_id / custom_data.email, else JWT sub as students.id when the sub is a UUID';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AcademicSource = 'postgres' | 'none';

export interface AcademicMeta {
  source: AcademicSource;
  studentId: string;
}

export interface AcademicList<T> {
  data: T[];
  meta: AcademicMeta;
}

export interface AttendanceDay {
  date: string;
  status: string;
  classId: string | null;
  comment: string | null;
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  late: number;
  excused: number;
  other: number;
  percentage: number | null;
}

export interface AttendancePayload extends AcademicList<AttendanceDay> {
  summary: AttendanceSummary;
}

export interface PublishedGrade {
  id: string;
  sectionId: string | null;
  assessmentCode: string | null;
  numericScore: number | null;
  letterGrade: string | null;
  workflowStatus: string;
  lockedAt: string | null;
  enteredAt: string;
}

export interface ReportCardSummary {
  id: string;
  academicPeriodId: string | null;
  status: string;
  outputUrl: string | null;
  completedAt: string | null;
}

export interface GradesPayload extends AcademicList<PublishedGrade> {
  reportCards: ReportCardSummary[];
}

export interface TimetableSlot {
  id: string;
  sectionId: string;
  sectionName: string | null;
  dayOfWeek: number;
  periodName: string | null;
  startTime: string | null;
  endTime: string | null;
  roomName: string | null;
}

export interface HomeworkItem {
  id: string;
  title: string;
  kind: string;
  subject: string | null;
  dueAt: string | null;
  status: string;
}

export interface CalendarEventItem {
  id: string;
  kind: string;
  name: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  academicPeriodId: string;
}

export interface NoticeItem {
  id: string;
  title: string;
  body: string | null;
  channel: string | null;
  sentAt: string | null;
}

export interface PalPlanItem {
  skillId: string;
  skillName: string | null;
  subject: string | null;
  bucket: 'review' | 'reinforce' | 'introduce';
  mastery: number | null;
  dueAt: string | null;
}

export interface AcademicVisibilityStore {
  resolveStudentId(tenantId: string, userId: string, email?: string | null): Promise<string | null>;
  getAttendance(tenantId: string, studentId: string): Promise<AttendancePayload>;
  getGrades(tenantId: string, studentId: string): Promise<GradesPayload>;
  getTimetable(tenantId: string, studentId: string): Promise<AcademicList<TimetableSlot>>;
  getHomework(tenantId: string, studentId: string): Promise<AcademicList<HomeworkItem>>;
  getCalendar(tenantId: string, studentId: string): Promise<AcademicList<CalendarEventItem>>;
  getNotices(
    tenantId: string,
    studentId: string,
    recipientUserId?: string | null,
  ): Promise<AcademicList<NoticeItem>>;
  getPalPlan(tenantId: string, studentId: string): Promise<AcademicList<PalPlanItem>>;
}

export const EMPTY_ATTENDANCE_SUMMARY: AttendanceSummary = {
  present: 0,
  absent: 0,
  late: 0,
  excused: 0,
  other: 0,
  percentage: null,
};

export function emptyAcademicList<T>(studentId: string): AcademicList<T> {
  return { data: [], meta: { source: 'none', studentId } };
}

export function summariseAttendance(days: AttendanceDay[]): AttendanceSummary {
  const summary: AttendanceSummary = {
    ...EMPTY_ATTENDANCE_SUMMARY,
    present: 0,
    absent: 0,
    late: 0,
    excused: 0,
    other: 0,
  };
  for (const day of days) {
    const status = day.status.toLowerCase();
    if (status === 'present') summary.present += 1;
    else if (status === 'absent') summary.absent += 1;
    else if (status === 'late') summary.late += 1;
    else if (status === 'excused') summary.excused += 1;
    else summary.other += 1;
  }
  const marked = summary.present + summary.absent + summary.late + summary.excused + summary.other;
  if (marked === 0) {
    summary.percentage = null;
    return summary;
  }
  const early = days.filter((d) => d.status.toLowerCase() === 'early_departure').length;
  const attended = summary.present + summary.late + 0.5 * early;
  summary.percentage = Math.round((attended / marked) * 10000) / 100;
  return summary;
}

export class EmptyAcademicVisibilityStore implements AcademicVisibilityStore {
  resolveStudentId(
    _tenantId: string,
    userId: string,
    _email?: string | null,
  ): Promise<string | null> {
    return Promise.resolve(UUID_RE.test(userId) ? userId : null);
  }

  getAttendance(_tenantId: string, studentId: string): Promise<AttendancePayload> {
    return Promise.resolve({
      ...emptyAcademicList<AttendanceDay>(studentId),
      summary: { ...EMPTY_ATTENDANCE_SUMMARY },
    });
  }

  getGrades(_tenantId: string, studentId: string): Promise<GradesPayload> {
    return Promise.resolve({ ...emptyAcademicList<PublishedGrade>(studentId), reportCards: [] });
  }

  getTimetable(_tenantId: string, studentId: string): Promise<AcademicList<TimetableSlot>> {
    return Promise.resolve(emptyAcademicList(studentId));
  }

  getHomework(_tenantId: string, studentId: string): Promise<AcademicList<HomeworkItem>> {
    return Promise.resolve(emptyAcademicList(studentId));
  }

  getCalendar(_tenantId: string, studentId: string): Promise<AcademicList<CalendarEventItem>> {
    return Promise.resolve(emptyAcademicList(studentId));
  }

  getNotices(
    _tenantId: string,
    studentId: string,
    _recipientUserId?: string | null,
  ): Promise<AcademicList<NoticeItem>> {
    return Promise.resolve(emptyAcademicList(studentId));
  }

  getPalPlan(_tenantId: string, studentId: string): Promise<AcademicList<PalPlanItem>> {
    return Promise.resolve(emptyAcademicList(studentId));
  }
}
