/**
 * Postgres academic visibility — queries existing domain tables when present.
 *
 * PRC-M316: a genuinely-absent optional relation (42P01, undefined_table) still returns an
 * empty-but-200 payload, but `meta.source` is now `'degraded'` (not an indistinguishable
 * `'none'`) and the degraded read is observably logged via `recordDegradedRead`. A 42703
 * (undefined_column) means the query assumed a schema shape this database does not have —
 * that is never swallowed as empty; it throws `AcademicColumnMissingError` instead.
 */
import { withPgTenant, type PgQueryable } from '@proctira/database';
import type pg from 'pg';

import { AcademicColumnMissingError } from './academic-visibility-errors.js';
import {
  isCampaignAudienceBroadcast,
  isParentVisibleGrade,
  selectBoundStudentId,
} from './academic-visibility.js';
import {
  attendancePercentageFromCounts,
  EMPTY_ATTENDANCE_SUMMARY,
  emptyAcademicList,
  type AcademicList,
  type AcademicVisibilityStore,
  type AttendanceDay,
  type AttendancePayload,
  type CalendarEventItem,
  type GradesPayload,
  type HomeworkItem,
  type LmsAssignmentItem,
  type LmsPayload,
  type NoticeItem,
  type PalPlanItem,
  type PublishedGrade,
  type ReportCardDetail,
  type ReportCardSummary,
  type TimetableSlot,
} from './academic-visibility.js';

export type PgPoolLike = Pick<pg.Pool, 'query'> & Partial<Pick<pg.Pool, 'connect'>>;

/** Structured, injectable hook so tests can assert a degraded read fired without stdout coupling. */
export type DegradedReadRecorder = (table: string, pgCode: string) => void;

function defaultRecordDegradedRead(table: string, pgCode: string): void {
  console.warn({ code: 'ACADEMIC_READ_DEGRADED', table, pgCode });
}

function isUndefinedTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: string }).code === '42P01';
}

function isUndefinedColumn(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: string }).code === '42703';
}

function asRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return value == null ? '' : String(value);
}

function strOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

/**
 * PRC-L083: never expose the raw `report_card_jobs.output_url` storage key to families. Return
 * the authenticated download path instead (mirrors assessment `report-card-routes.ts`
 * `downloadUrl`), or null when the job has no output.
 */
function reportCardDownloadPath(row: Record<string, unknown>): string | null {
  return row.output_url ? `/report-cards/jobs/${str(row.id)}/download` : null;
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dateStr(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value ?? '');
  return raw.length >= 10 ? raw.slice(0, 10) : raw;
}

function isoOrNull(value: unknown): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Per-call degraded flag threaded up from `queryRows` to the public method that sets `meta`. */
interface DegradedFlag {
  degraded: boolean;
}

async function queryRows(
  client: PgQueryable,
  sql: string,
  values: unknown[],
  table: string,
  recordDegradedRead: DegradedReadRecorder,
  flag?: DegradedFlag,
): Promise<Record<string, unknown>[]> {
  try {
    const result = await client.query(sql, values);
    return result.rows.map(asRecord);
  } catch (error) {
    if (isUndefinedColumn(error)) throw new AcademicColumnMissingError();
    if (isUndefinedTable(error)) {
      recordDegradedRead(table, '42P01');
      if (flag) flag.degraded = true;
      return [];
    }
    throw error;
  }
}

function publishedWorkflow(metadata: unknown): string | null {
  if (metadata && typeof metadata === 'object') {
    const status = (metadata as { workflowStatus?: unknown }).workflowStatus;
    if (typeof status === 'string') return status;
  }
  if (typeof metadata === 'string') {
    try {
      const parsed = JSON.parse(metadata) as { workflowStatus?: unknown };
      if (typeof parsed.workflowStatus === 'string') return parsed.workflowStatus;
    } catch {
      return null;
    }
  }
  return null;
}

export class PgAcademicVisibilityStore implements AcademicVisibilityStore {
  private readonly recordDegradedRead: DegradedReadRecorder;

  constructor(
    private readonly pool: PgPoolLike,
    recordDegradedRead: DegradedReadRecorder = defaultRecordDegradedRead,
  ) {
    this.recordDegradedRead = recordDegradedRead;
  }

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool as never, tenantId, fn);
  }

  /**
   * `meta` honouring a per-call degraded flag over the plain postgres/none choice. When a
   * 42P01 occurred anywhere in this call's queries, `source` is `'degraded'` with
   * `degradedReason: 'relation_missing'`, distinguishing it from a genuinely-empty result.
   */
  private metaFor(
    studentId: string,
    hasData: boolean,
    flag: DegradedFlag,
  ): { source: 'postgres' | 'none' | 'degraded'; studentId: string; degradedReason?: string } {
    if (flag.degraded) {
      return { source: 'degraded', studentId, degradedReason: 'relation_missing' };
    }
    return { source: hasData ? 'postgres' : 'none', studentId };
  }

  /**
   * PRC-H075: bind a student principal to exactly one `students` row through an explicit
   * identity link only — `students.id = sub` or `custom_data.user_id = sub`. Email and
   * `contacts[0]` (usually a guardian contact shared by siblings) are never matched. Every
   * candidate is fetched (no LIMIT) so an ambiguous link fails closed via
   * `selectBoundStudentId` instead of resolving to an arbitrary row.
   */
  async resolveStudentId(tenantId: string, userId: string): Promise<string | null> {
    if (!userId) return null;
    return this.withTenant(tenantId, async (client) => {
      const rows = await queryRows(
        client,
        `SELECT DISTINCT id
           FROM students
          WHERE tenant_id = $1::uuid
            AND deleted_at IS NULL
            AND (
              id::text = $2
              OR custom_data @> jsonb_build_object('user_id', $2::text)
            )
          ORDER BY id`,
        [tenantId, userId],
        'students',
        this.recordDegradedRead,
      );
      return selectBoundStudentId(
        rows.map((row) => strOrNull(row.id)).filter((id): id is string => id !== null),
      );
    });
  }

  /**
   * PRC-M534: percentage is computed in SQL (`COUNT FILTER`) over the student's full active
   * academic period, not an app-side slice of the last 30 rows. The display list (`data`) keeps
   * its own separate `ORDER BY date DESC LIMIT 30` — that cap is a UI concern the finding is not
   * about and is preserved unchanged.
   *
   * `student_attendance.status` is stored upper-case in this table: the Prisma schema maps a
   * plain VARCHAR(20) column, but db/sql/042_attendance_ops_schema.sql enforces
   * `CHECK (status IN ('PRESENT','ABSENT','LATE','EXCUSED','EARLY_DEPARTURE'))` and every writer
   * (attendance-service.ts's `AttendanceStatus` enum) only ever writes those upper-case literals.
   * The aggregate below compares against upper-case to match.
   */
  async getAttendance(tenantId: string, studentId: string): Promise<AttendancePayload> {
    return this.withTenant(tenantId, async (client) => {
      const flag: DegradedFlag = { degraded: false };

      const periodRows = await queryRows(
        client,
        `SELECT ap.start_date, ap.end_date
           FROM enrollments en
           JOIN academic_periods ap ON ap.id = en.academic_period_id
          WHERE en.tenant_id = $1::uuid
            AND en.student_id = $2::uuid
            AND en.status::text IN ('ENROLLED', 'enrolled')
          ORDER BY en.enrolled_at DESC
          LIMIT 1`,
        [tenantId, studentId],
        'enrollments',
        this.recordDegradedRead,
        flag,
      );

      const dayRows = await queryRows(
        client,
        `SELECT date, status, class_id, comment
           FROM student_attendance
          WHERE tenant_id = $1::uuid AND student_id = $2::uuid
          ORDER BY date DESC
          LIMIT 30`,
        [tenantId, studentId],
        'student_attendance',
        this.recordDegradedRead,
        flag,
      );
      const data: AttendanceDay[] = dayRows.map((row) => ({
        date: dateStr(row.date),
        status: str(row.status),
        classId: strOrNull(row.class_id),
        comment: strOrNull(row.comment),
      }));

      const period = periodRows[0];
      if (!period) {
        // No resolvable active-period bound to aggregate over — report the display list (if
        // any) without a full-period percentage, rather than silently falling back to the
        // display-list slice the finding was about.
        return {
          data,
          summary: { ...EMPTY_ATTENDANCE_SUMMARY },
          meta: this.metaFor(studentId, data.length > 0, flag),
        };
      }

      const countRows = await queryRows(
        client,
        `SELECT
            COUNT(*) FILTER (WHERE status = 'PRESENT') AS present_count,
            COUNT(*) FILTER (WHERE status = 'ABSENT') AS absent_count,
            COUNT(*) FILTER (WHERE status = 'LATE') AS late_count,
            COUNT(*) FILTER (WHERE status = 'EXCUSED') AS excused_count,
            COUNT(*) FILTER (WHERE status = 'EARLY_DEPARTURE') AS early_departure_count,
            COUNT(*) AS total_count
           FROM student_attendance
          WHERE tenant_id = $1::uuid
            AND student_id = $2::uuid
            AND date >= $3::date
            AND date <= $4::date`,
        [tenantId, studentId, dateStr(period.start_date), dateStr(period.end_date)],
        'student_attendance',
        this.recordDegradedRead,
        flag,
      );
      const counts = countRows[0];
      const present = Number(counts?.present_count ?? 0);
      const absent = Number(counts?.absent_count ?? 0);
      const late = Number(counts?.late_count ?? 0);
      const excused = Number(counts?.excused_count ?? 0);
      const earlyDeparture = Number(counts?.early_departure_count ?? 0);
      const total = Number(counts?.total_count ?? 0);
      const other = Math.max(0, total - present - absent - late - excused - earlyDeparture);

      const summary = {
        present,
        absent,
        late,
        excused,
        other,
        percentage: attendancePercentageFromCounts({
          present,
          absent,
          late,
          excused,
          earlyDeparture,
          total,
        }),
      };

      return {
        data,
        summary,
        meta: this.metaFor(studentId, total > 0 || data.length > 0, flag),
      };
    });
  }

  async getGrades(tenantId: string, studentId: string): Promise<GradesPayload> {
    return this.withTenant(tenantId, async (client) => {
      const flag: DegradedFlag = { degraded: false };
      const gradeRows = await queryRows(
        client,
        `SELECT id, section_id, assessment_code, numeric_score, letter_grade,
                locked_at, published_at, entered_at, metadata
           FROM grade_entries
          WHERE tenant_id = $1::uuid AND student_id = $2::uuid
          ORDER BY entered_at DESC
          LIMIT 100`,
        [tenantId, studentId],
        'grade_entries',
        this.recordDegradedRead,
        flag,
      );
      const data: PublishedGrade[] = [];
      for (const row of gradeRows) {
        const workflowStatus = publishedWorkflow(row.metadata) ?? 'DRAFT';
        const publishedAt = isoOrNull(row.published_at);
        if (!isParentVisibleGrade({ workflowStatus, publishedAt })) continue;
        data.push({
          id: str(row.id),
          sectionId: strOrNull(row.section_id),
          assessmentCode: strOrNull(row.assessment_code),
          numericScore: numOrNull(row.numeric_score),
          letterGrade: strOrNull(row.letter_grade),
          workflowStatus,
          lockedAt: isoOrNull(row.locked_at),
          enteredAt: isoOrNull(row.entered_at) ?? new Date(0).toISOString(),
        });
      }
      const reportRows = await queryRows(
        client,
        `SELECT id, academic_period_id, status, output_url, completed_at
           FROM report_card_jobs
          WHERE tenant_id = $1::uuid AND student_id = $2::uuid
            AND status IN ('completed', 'COMPLETED', 'SUCCEEDED')
          ORDER BY created_at DESC
          LIMIT 20`,
        [tenantId, studentId],
        'report_card_jobs',
        this.recordDegradedRead,
        flag,
      );
      const reportCards: ReportCardSummary[] = reportRows.map((row) => ({
        id: str(row.id),
        academicPeriodId: strOrNull(row.academic_period_id),
        status: str(row.status),
        outputUrl: reportCardDownloadPath(row),
        completedAt: isoOrNull(row.completed_at),
      }));
      return {
        data,
        reportCards,
        meta: this.metaFor(studentId, data.length > 0 || reportCards.length > 0, flag),
      };
    });
  }

  async getTimetable(tenantId: string, studentId: string): Promise<AcademicList<TimetableSlot>> {
    return this.withTenant(tenantId, async (client) => {
      const flag: DegradedFlag = { degraded: false };
      const rows = await queryRows(
        client,
        `SELECT m.id,
                m.section_id,
                s.name AS section_name,
                m.day_of_week,
                bp.name AS period_name,
                bp.start_time::text AS start_time,
                bp.end_time::text AS end_time,
                r.name AS room_name
           FROM section_enrollments se
           JOIN sections s ON s.id = se.section_id
           JOIN section_meetings m ON m.section_id = se.section_id AND m.tenant_id = se.tenant_id
           LEFT JOIN bell_periods bp ON bp.id = m.bell_period_id
           LEFT JOIN rooms r ON r.id = m.room_id
          WHERE se.tenant_id = $1::uuid
            AND se.student_id = $2::uuid
            AND se.status = 'ENROLLED'
            AND s.status = 'PUBLISHED'
            AND m.deleted_at IS NULL
            AND s.deleted_at IS NULL
          ORDER BY m.day_of_week, bp.period_order NULLS LAST`,
        [tenantId, studentId],
        'section_meetings',
        this.recordDegradedRead,
        flag,
      );
      const data: TimetableSlot[] = rows.map((row) => ({
        id: str(row.id),
        sectionId: str(row.section_id),
        sectionName: strOrNull(row.section_name),
        dayOfWeek: Number(row.day_of_week) || 0,
        periodName: strOrNull(row.period_name),
        startTime: strOrNull(row.start_time),
        endTime: strOrNull(row.end_time),
        roomName: strOrNull(row.room_name),
      }));
      return {
        data,
        meta: this.metaFor(studentId, data.length > 0, flag),
      };
    });
  }

  async getHomework(tenantId: string, studentId: string): Promise<AcademicList<HomeworkItem>> {
    return this.withTenant(tenantId, async (client) => {
      const flag: DegradedFlag = { degraded: false };
      const rows = await queryRows(
        client,
        `SELECT a.id, a.title, a.kind, a.subject, a.due_at, a.status
           FROM lms_assignments a
          WHERE a.tenant_id = $1::uuid
            AND a.status = 'published'
            AND (
              a.section_id IS NULL
              OR a.section_id IN (
                SELECT section_id FROM section_enrollments
                 WHERE tenant_id = $1::uuid AND student_id = $2::uuid AND status = 'ENROLLED'
              )
            )
          ORDER BY a.due_at NULLS LAST
          LIMIT 50`,
        [tenantId, studentId],
        'lms_assignments',
        this.recordDegradedRead,
        flag,
      );
      const data: HomeworkItem[] = rows.map((row) => ({
        id: str(row.id),
        title: str(row.title),
        kind: str(row.kind),
        subject: strOrNull(row.subject),
        dueAt: isoOrNull(row.due_at),
        status: str(row.status),
      }));
      return {
        data,
        meta: this.metaFor(studentId, data.length > 0, flag),
      };
    });
  }

  async getLms(tenantId: string, studentId: string): Promise<LmsPayload> {
    return this.withTenant(tenantId, async (client) => {
      const flag: DegradedFlag = { degraded: false };
      const rows = await queryRows(
        client,
        `SELECT a.id, a.title, a.kind, a.subject, a.due_at, a.status, a.max_score,
                s.status AS submission_status, s.score, s.graded_at, s.feedback
           FROM lms_assignments a
           LEFT JOIN lms_submissions s
             ON s.assignment_id = a.id
            AND s.tenant_id = a.tenant_id
            AND s.student_id = $2::uuid
          WHERE a.tenant_id = $1::uuid
            AND a.status IN ('published', 'closed')
            AND (
              a.section_id IS NULL
              OR a.section_id IN (
                SELECT section_id FROM section_enrollments
                 WHERE tenant_id = $1::uuid AND student_id = $2::uuid AND status = 'ENROLLED'
              )
            )
          ORDER BY a.due_at NULLS LAST
          LIMIT 100`,
        [tenantId, studentId],
        'lms_assignments',
        this.recordDegradedRead,
        flag,
      );
      const data: LmsAssignmentItem[] = rows.map((row) => ({
        id: str(row.id),
        title: str(row.title),
        kind: str(row.kind),
        subject: strOrNull(row.subject),
        dueAt: isoOrNull(row.due_at),
        maxScore: numOrNull(row.max_score),
        status: str(row.status),
        submissionStatus: strOrNull(row.submission_status),
        score: numOrNull(row.score),
        gradedAt: isoOrNull(row.graded_at),
        feedback: strOrNull(row.feedback),
      }));
      const assigned = data.length;
      const submitted = data.filter(
        (d) => d.submissionStatus && d.submissionStatus !== 'draft',
      ).length;
      const graded = data.filter((d) => d.score != null).length;
      const missing = data.filter((d) => !d.submissionStatus).length;
      const scored = data.filter((d) => d.score != null && d.maxScore && d.maxScore > 0);
      const averageScorePercent =
        scored.length === 0
          ? null
          : Math.round(
              (scored.reduce((acc, d) => acc + ((d.score ?? 0) / (d.maxScore ?? 1)) * 100, 0) /
                scored.length) *
                100,
            ) / 100;
      return {
        data,
        summary: { assigned, submitted, graded, missing, averageScorePercent },
        meta: this.metaFor(studentId, data.length > 0, flag),
      };
    });
  }

  async getReportCards(
    tenantId: string,
    studentId: string,
  ): Promise<AcademicList<ReportCardDetail>> {
    return this.withTenant(tenantId, async (client) => {
      const flag: DegradedFlag = { degraded: false };
      const cards = await queryRows(
        client,
        `SELECT id, academic_period_id, status, output_url, completed_at
           FROM report_card_jobs
          WHERE tenant_id = $1::uuid AND student_id = $2::uuid
            AND status IN ('completed', 'COMPLETED', 'SUCCEEDED')
          ORDER BY created_at DESC
          LIMIT 20`,
        [tenantId, studentId],
        'report_card_jobs',
        this.recordDegradedRead,
        flag,
      );
      const data: ReportCardDetail[] = [];
      for (const row of cards) {
        const subjects = await queryRows(
          client,
          `SELECT subject, numeric_score, letter_grade, remarks
             FROM report_card_subject_lines
            WHERE tenant_id = $1::uuid AND report_card_job_id = $2::uuid
            ORDER BY position ASC NULLS LAST, subject ASC`,
          [tenantId, str(row.id)],
          'report_card_subject_lines',
          this.recordDegradedRead,
          flag,
        );
        // Fallback: published gradebook rows for the period when subject lines table is absent/empty
        let subjectLines = subjects.map((s) => ({
          subject: str(s.subject),
          numericScore: numOrNull(s.numeric_score),
          letterGrade: strOrNull(s.letter_grade),
          remarks: strOrNull(s.remarks),
        }));
        if (subjectLines.length === 0 && row.academic_period_id) {
          const grades = await queryRows(
            client,
            `SELECT COALESCE(ge.subject, ge.assessment_code, 'Subject') AS subject,
                    ge.numeric_score, ge.letter_grade, ge.comment AS remarks
               FROM grade_entries ge
              WHERE ge.tenant_id = $1::uuid AND ge.student_id = $2::uuid
                AND (
                  ge.academic_period_id = $3::uuid
                  OR ge.metadata->>'academicPeriodId' = $3::text
                )
                AND (
                  ge.published_at IS NOT NULL
                  OR COALESCE(ge.metadata->>'workflowStatus', '') = 'PUBLISHED'
                )
              ORDER BY ge.entered_at DESC
              LIMIT 40`,
            [tenantId, studentId, str(row.academic_period_id)],
            'grade_entries',
            this.recordDegradedRead,
            flag,
          );
          subjectLines = grades.map((g) => ({
            subject: str(g.subject),
            numericScore: numOrNull(g.numeric_score),
            letterGrade: strOrNull(g.letter_grade),
            remarks: strOrNull(g.remarks),
          }));
        }
        data.push({
          id: str(row.id),
          academicPeriodId: strOrNull(row.academic_period_id),
          status: str(row.status),
          outputUrl: reportCardDownloadPath(row),
          completedAt: isoOrNull(row.completed_at),
          subjects: subjectLines,
        });
      }
      return {
        data,
        meta: this.metaFor(studentId, data.length > 0, flag),
      };
    });
  }

  async getCalendar(tenantId: string, studentId: string): Promise<AcademicList<CalendarEventItem>> {
    return this.withTenant(tenantId, async (client) => {
      const flag: DegradedFlag = { degraded: false };
      const periodRows = await queryRows(
        client,
        `SELECT academic_period_id
           FROM enrollments
          WHERE tenant_id = $1::uuid AND student_id = $2::uuid
            AND status::text IN ('ENROLLED', 'enrolled')
          ORDER BY enrolled_at DESC
          LIMIT 1`,
        [tenantId, studentId],
        'enrollments',
        this.recordDegradedRead,
        flag,
      );
      const periodId = periodRows[0] ? strOrNull(periodRows[0].academic_period_id) : null;
      if (!periodId) {
        return {
          ...emptyAcademicList<CalendarEventItem>(studentId),
          meta: this.metaFor(studentId, false, flag),
        };
      }

      const rows = await queryRows(
        client,
        `SELECT e.id, e.kind, e.name, e.start_date, e.end_date, e.notes, e.academic_period_id
           FROM academic_calendar_events e
          WHERE e.tenant_id = $1::uuid
            AND (
              e.academic_period_id = $2::uuid
              OR e.academic_period_id IN (
                SELECT id FROM academic_periods WHERE tenant_id = $1::uuid AND parent_id = $2::uuid
              )
              OR e.academic_period_id IN (
                SELECT parent_id FROM academic_periods WHERE id = $2::uuid AND parent_id IS NOT NULL
              )
            )
          ORDER BY e.start_date`,
        [tenantId, periodId],
        'academic_calendar_events',
        this.recordDegradedRead,
        flag,
      );
      const data: CalendarEventItem[] = rows.map((row) => ({
        id: str(row.id),
        kind: str(row.kind),
        name: str(row.name),
        startDate: dateStr(row.start_date),
        endDate: dateStr(row.end_date),
        notes: strOrNull(row.notes),
        academicPeriodId: str(row.academic_period_id),
      }));
      return {
        data,
        meta: this.metaFor(studentId, data.length > 0, flag),
      };
    });
  }

  async getNotices(
    tenantId: string,
    studentId: string,
    recipientUserId?: string | null,
  ): Promise<AcademicList<NoticeItem>> {
    return this.withTenant(tenantId, async (client) => {
      const flag: DegradedFlag = { degraded: false };
      const campaignRows = (
        await queryRows(
          client,
          // PRC-H074: only tenant-wide broadcasts are portal-visible. Narrowly-targeted campaigns
          // (grade/hostel/route/custom) are withheld until a per-student segment resolver exists,
          // so a family never sees a notice addressed to a cohort they are not proven to be in.
          // The broadcast predicate is applied in SQL (not after LIMIT) so the limit counts only
          // already-visible rows and cannot let targeted volume push broadcasts out of view.
          // isCampaignAudienceBroadcast() is the authoritative predicate and is re-applied below.
          `SELECT id, name AS title, body, sent_at, audience_json
             FROM comms_campaigns
            WHERE tenant_id = $1::uuid
              AND status = 'sent'
              AND (
                audience_json IS NULL
                OR NULLIF(lower(audience_json->>'scope'), '') IS NULL
                OR lower(audience_json->>'scope') = 'all'
              )
            ORDER BY sent_at DESC NULLS LAST
            LIMIT 30`,
          [tenantId],
          'comms_campaigns',
          this.recordDegradedRead,
          flag,
        )
      ).filter((row) => isCampaignAudienceBroadcast(row.audience_json));
      const noticeRows =
        recipientUserId != null && recipientUserId.length > 0
          ? await queryRows(
              client,
              `SELECT id, channel, status, sent_at, variables
                 FROM notifications
                WHERE tenant_id = $1::uuid AND recipient_user_id = $2
                ORDER BY created_at DESC
                LIMIT 30`,
              [tenantId, recipientUserId],
              'notifications',
              this.recordDegradedRead,
              flag,
            )
          : [];
      const data: NoticeItem[] = [
        ...campaignRows.map((row) => ({
          id: str(row.id),
          title: str(row.title) || 'School notice',
          body: strOrNull(row.body),
          channel: 'campaign',
          sentAt: isoOrNull(row.sent_at),
        })),
        ...noticeRows.map((row) => {
          const variables =
            row.variables && typeof row.variables === 'object'
              ? (row.variables as Record<string, unknown>)
              : {};
          return {
            id: str(row.id),
            title: str(variables.title ?? variables.subject ?? 'Notice'),
            body: strOrNull(variables.body ?? variables.message),
            channel: strOrNull(row.channel),
            sentAt: isoOrNull(row.sent_at),
          };
        }),
      ];
      return {
        data,
        meta: this.metaFor(studentId, data.length > 0, flag),
      };
    });
  }

  async getPalPlan(tenantId: string, studentId: string): Promise<AcademicList<PalPlanItem>> {
    return this.withTenant(tenantId, async (client) => {
      const flag: DegradedFlag = { degraded: false };
      const rows = await queryRows(
        client,
        `SELECT m.skill_id, m.mastery, m.due_at, m.streak,
                s.name AS skill_name, s.subject
           FROM lms_skill_mastery m
           LEFT JOIN lms_skills s ON s.id = m.skill_id
          WHERE m.tenant_id = $1::uuid AND m.student_id = $2::uuid
          ORDER BY m.due_at NULLS LAST
          LIMIT 40`,
        [tenantId, studentId],
        'lms_skill_mastery',
        this.recordDegradedRead,
        flag,
      );
      const now = Date.now();
      const data: PalPlanItem[] = rows.map((row) => {
        const mastery = numOrNull(row.mastery);
        const dueAt = isoOrNull(row.due_at);
        const dueMs = dueAt ? new Date(dueAt).getTime() : null;
        let bucket: PalPlanItem['bucket'] = 'introduce';
        if (dueMs != null && dueMs <= now) bucket = 'review';
        else if (mastery != null && mastery < 0.8) bucket = 'reinforce';
        return {
          skillId: str(row.skill_id),
          skillName: strOrNull(row.skill_name),
          subject: strOrNull(row.subject),
          bucket,
          mastery,
          dueAt,
        };
      });
      return {
        data,
        meta: this.metaFor(studentId, data.length > 0, flag),
      };
    });
  }
}
