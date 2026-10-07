/**
 * Parent/student academic visibility — read models aggregated from domain tables.
 *
 * Student self-binding (PRC-H075): `students` has no `user_id` column. A student JWT
 * binds to a row only through an explicit identity link on the principal id —
 * `students.id = sub` or `custom_data.user_id = sub` — and must match exactly one row.
 * Email and `contacts[0]` are never used: they are not unique (siblings share guardian
 * contacts) and the principal carries no email-verification state. Zero matches is 404;
 * more than one is a fail-closed 409.
 */
import { ConflictError } from '@proctira/common';

export const STUDENT_SELF_BINDING_ASSUMPTION =
  'students has no user_id column; bind only when exactly one row has students.id = sub or custom_data.user_id = sub (no email/contact matching); 0 matches -> 404, >1 -> 409';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Parents and students see a grade only after it is published. */
export function isParentVisibleGrade(input: {
  workflowStatus?: string | null;
  publishedAt?: string | null;
}): boolean {
  if (input.publishedAt) return true;
  return input.workflowStatus === 'PUBLISHED';
}

/**
 * PRC-H074: audience scoping for campaign notices surfaced in the parent/student portal.
 *
 * `comms_campaigns.audience_json` describes who a campaign targets (`scope`: all | grade |
 * hostel | route | custom, with optional grade/hostelId/routeId/ids). The portal notices feed
 * previously returned EVERY sent campaign for the tenant, so a parent of a class-B student could
 * read a notice addressed only to class A (or a specific hostel/route/custom recipient list).
 *
 * A per-student segment resolver (grade/hostel/route/custom → studentIds) does not yet exist in
 * this store, so we cannot positively prove membership for a narrowed audience. Until it does,
 * only genuine tenant-wide broadcasts are visible; any narrower scope is withheld rather than
 * leaked. This is fail-closed: it can hide a legitimately-targeted notice, but never exposes a
 * notice to a family outside its audience.
 */
export function isCampaignAudienceBroadcast(audienceJson: unknown): boolean {
  if (audienceJson == null) return true;
  if (typeof audienceJson !== 'object') return false;
  const raw = (audienceJson as Record<string, unknown>)['scope'];
  // Absent scope historically meant "everyone" (see communication estimator default 'all').
  if (raw == null || raw === '') return true;
  return String(raw).toLowerCase() === 'all';
}

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

/** Parent academic 360 — LMS depth beyond a flat homework list. */
export interface LmsAssignmentItem {
  id: string;
  title: string;
  kind: string;
  subject: string | null;
  dueAt: string | null;
  maxScore: number | null;
  status: string;
  submissionStatus: string | null;
  score: number | null;
  gradedAt: string | null;
  feedback: string | null;
}

export interface LmsPayload extends AcademicList<LmsAssignmentItem> {
  summary: {
    assigned: number;
    submitted: number;
    graded: number;
    missing: number;
    averageScorePercent: number | null;
  };
}

export interface ReportCardSubjectLine {
  subject: string;
  numericScore: number | null;
  letterGrade: string | null;
  remarks: string | null;
}

export interface ReportCardDetail {
  id: string;
  academicPeriodId: string | null;
  status: string;
  outputUrl: string | null;
  completedAt: string | null;
  subjects: ReportCardSubjectLine[];
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
  /**
   * Resolve the single `students.id` explicitly linked to principal `userId`.
   * Returns null when no row is linked; throws `ConflictError` when more than one is.
   */
  resolveStudentId(tenantId: string, userId: string): Promise<string | null>;
  getAttendance(tenantId: string, studentId: string): Promise<AttendancePayload>;
  getGrades(tenantId: string, studentId: string): Promise<GradesPayload>;
  getTimetable(tenantId: string, studentId: string): Promise<AcademicList<TimetableSlot>>;
  getHomework(tenantId: string, studentId: string): Promise<AcademicList<HomeworkItem>>;
  getLms(tenantId: string, studentId: string): Promise<LmsPayload>;
  getReportCards(tenantId: string, studentId: string): Promise<AcademicList<ReportCardDetail>>;
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

/**
 * PRC-H075: the only accepted outcome of a self-binding lookup is exactly one candidate.
 * Shared by the Postgres and in-memory stores so both fail closed identically.
 */
export function selectBoundStudentId(candidateIds: readonly string[]): string | null {
  const unique = [...new Set(candidateIds)];
  if (unique.length === 0) return null;
  if (unique.length > 1) {
    throw new ConflictError(
      'Student account is linked to more than one student record; contact the school office',
    );
  }
  return unique[0]!;
}

/**
 * No-database store: there are no student rows, so the explicit `students.id = sub` link is
 * the only one available. Every academic read returns an empty list, so nothing can leak.
 */
export class EmptyAcademicVisibilityStore implements AcademicVisibilityStore {
  resolveStudentId(_tenantId: string, userId: string): Promise<string | null> {
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

  getLms(_tenantId: string, studentId: string): Promise<LmsPayload> {
    return Promise.resolve({
      ...emptyAcademicList<LmsAssignmentItem>(studentId),
      summary: { assigned: 0, submitted: 0, graded: 0, missing: 0, averageScorePercent: null },
    });
  }

  getReportCards(_tenantId: string, studentId: string): Promise<AcademicList<ReportCardDetail>> {
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

/** A `students` row as far as self-binding is concerned (mirrors the Postgres columns read). */
export interface InMemoryStudentIdentityRecord {
  id: string;
  tenantId: string;
  /** `custom_data.user_id` — the explicit principal link. */
  userId?: string | null;
  /** `custom_data.email` — stored for parity with real rows; never used to bind. */
  email?: string | null;
  /** `custom_data.contacts` — usually guardian contacts; never used to bind. */
  contacts?: Array<{ type?: string; value: string }>;
  deleted?: boolean;
}

/**
 * In-memory equivalent of `PgAcademicVisibilityStore.resolveStudentId` (PRC-H075): binds only on
 * `id = sub` or `userId = sub` within the tenant and fails closed on ambiguity. Academic reads
 * are empty, as in `EmptyAcademicVisibilityStore`.
 */
export class InMemoryAcademicVisibilityStore extends EmptyAcademicVisibilityStore {
  constructor(private readonly students: InMemoryStudentIdentityRecord[] = []) {
    super();
  }

  override resolveStudentId(tenantId: string, userId: string): Promise<string | null> {
    if (!userId) return Promise.resolve(null);
    try {
      const candidates = this.students
        .filter((s) => s.tenantId === tenantId && !s.deleted)
        .filter((s) => s.id === userId || (s.userId != null && s.userId === userId))
        .map((s) => s.id);
      return Promise.resolve(selectBoundStudentId(candidates));
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
