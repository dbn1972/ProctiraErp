/**
 * Cross-module analytical {@link ReportDataSource}.
 *
 * Fetches rows from domain repositories (injected deps) with per-schema
 * queries, then joins / aggregates in application memory by bare UUID.
 * Never issues SQL JOINs or FKs across Postgres schemas.
 *
 * Supported report types (aliases in parentheses):
 * - student_enrollment (enrollment)
 * - enrollment_summary — aggregates enrollments by institution/status/grade
 * - students
 * - attendance_summary (attendance)
 * - examination_results (examinations)
 * - scholarship_applications (scholarships)
 * - scholarship_utilization
 */
import type { AggregationConfig } from './schemas.js';
import type {
  ReportColumn,
  ReportDataResult,
  ReportDataSource,
  ReportUserContext,
} from './report-repository.js';

// ─── Shared page helpers ─────────────────────────────────────────────────────

export interface ReportPageOptions {
  page: number;
  pageSize: number;
}

/** Matches {@link PaginatedResult} from `@proctira/common` for structural typing. */
export interface ReportPage<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

const PAGE_SIZE = 500;
const MAX_PAGES = 40; // hard cap ~20k rows per report fetch

async function collectAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<ReportPage<T>>,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await fetchPage(page, PAGE_SIZE);
    all.push(...result.data);
    if (all.length >= result.meta.totalItems || result.data.length === 0) break;
  }
  return all;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asIsoDate(value: unknown, fallback: string): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return fallback;
}

// ─── Domain ports (structural — gateway injects real repositories) ───────────

export interface ReportStudentRow {
  id: string;
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  nationalId: string | null;
}

export interface ReportEnrollmentRow {
  id: string;
  studentId: string;
  institutionId: string;
  gradeId: string;
  classId: string | null;
  academicPeriodId: string;
  status: string;
  enrolledAt: Date;
  exitedAt: Date | null;
}

export interface ReportInstitutionRow {
  id: string;
  name: string;
  code: string;
  areaId: string;
  status: string;
}

export interface ReportAttendanceRow {
  id: string;
  studentId: string;
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  date: string;
  status: string;
  subjectId: string | null;
  periodId: string | null;
}

export interface ReportExaminationRow {
  id: string;
  name: string;
  code: string;
  academicPeriodId: string;
  status: string;
  startDate: string;
  endDate: string;
}

export interface ReportPublicationGradeRow {
  candidateId: string;
  studentId: string;
  subjectId: string;
  score: number;
  grade: string;
  passed: boolean;
}

export interface ReportPublicationResult {
  examinationId: string;
  publishedAt: Date;
  totalCandidates: number;
  processedCount: number;
  incompleteCount: number;
  gradeResults: ReportPublicationGradeRow[];
}

export interface ReportScholarshipApplicationRow {
  id: string;
  programId: string;
  applicantId: string;
  institutionId: string;
  status: string;
  areaId: string | null;
  gender: string | null;
  submittedAt: Date;
}

export interface ReportScholarshipProgramRow {
  id: string;
  name: string;
  status: string;
  amountPerRecipient: number;
  currency: string;
  totalSlots: number;
  usedSlots: number;
}

export interface ReportUtilizationBreakdownItem {
  groupKey: string;
  groupValue: string;
  applicationCount: number;
  approvedCount: number;
  disbursedAmount: number;
  utilizationRate: number;
}

export interface ReportUtilizationData {
  totalPrograms: number;
  totalApplications: number;
  totalApproved: number;
  totalDisbursed: number;
  totalAmount: number;
  currency: string;
  breakdown: ReportUtilizationBreakdownItem[];
}

export interface ReportStudentPort {
  list(
    tenantId: string,
    filter: { gender?: string; search?: string },
    pagination: ReportPageOptions,
  ): Promise<ReportPage<ReportStudentRow>>;
  findById?(id: string, tenantId: string): Promise<ReportStudentRow | null>;
}

export interface ReportEnrollmentPort {
  listEnrollments(
    tenantId: string,
    filter: {
      studentId?: string;
      institutionId?: string;
      academicPeriodId?: string;
      status?: 'ENROLLED' | 'TRANSFERRED' | 'WITHDRAWN' | 'GRADUATED';
    },
    pagination: ReportPageOptions,
  ): Promise<ReportPage<ReportEnrollmentRow>>;
}

export interface ReportInstitutionPort {
  list(
    tenantId: string,
    filter: { areaId?: string; status?: 'ACTIVE' | 'INACTIVE'; search?: string },
    pagination: ReportPageOptions,
  ): Promise<ReportPage<ReportInstitutionRow>>;
  findById(id: string, tenantId: string): Promise<ReportInstitutionRow | null>;
}

export interface ReportAttendancePort {
  listStudentAttendanceByDateRange(
    tenantId: string,
    query: {
      scope: 'student' | 'class' | 'institution';
      studentId?: string;
      classId?: string;
      institutionId?: string;
      startDate: string;
      endDate: string;
    },
  ): Promise<ReportAttendanceRow[]>;
}

export interface ReportExaminationPort {
  list(
    tenantId: string,
    filter: { academicPeriodId?: string; status?: string; search?: string },
    pagination: ReportPageOptions,
  ): Promise<ReportPage<ReportExaminationRow>>;
}

export interface ReportExaminationResultPort {
  getPublicationResult(
    examinationId: string,
    tenantId: string,
  ): Promise<ReportPublicationResult | null>;
}

export interface ReportScholarshipPort {
  listApplications(
    tenantId: string,
    filter: {
      programId?: string;
      applicantId?: string;
      institutionId?: string;
      status?: string;
      areaId?: string;
      gender?: string;
    },
    pagination: ReportPageOptions,
  ): Promise<ReportPage<ReportScholarshipApplicationRow>>;
  listPrograms(
    tenantId: string,
    filter: { status?: string; search?: string },
    pagination: ReportPageOptions,
  ): Promise<ReportPage<ReportScholarshipProgramRow>>;
  getUtilizationReport?(
    tenantId: string,
    filter: {
      programId?: string;
      areaId?: string;
      gender?: string;
      institutionId?: string;
      startDate?: string;
      endDate?: string;
      groupBy?: 'program' | 'area' | 'gender' | 'institution';
    },
  ): Promise<ReportUtilizationData>;
}

/**
 * Injectable domain repositories used for sequential per-schema reads.
 * All ports are optional; report types whose deps are missing return empty.
 */
export interface CrossModuleReportDataSourceDeps {
  students?: ReportStudentPort;
  enrollments?: ReportEnrollmentPort;
  institutions?: ReportInstitutionPort;
  attendance?: ReportAttendancePort;
  examinations?: ReportExaminationPort;
  examinationResults?: ReportExaminationResultPort;
  scholarships?: ReportScholarshipPort;
}

// ─── In-memory grouping / aggregation ────────────────────────────────────────

function applyGroupByAndAggregations(
  rows: Record<string, unknown>[],
  columns: ReportColumn[],
  groupBy: string[] | null,
  aggregations: AggregationConfig[] | null,
): ReportDataResult {
  if (!groupBy?.length && !aggregations?.length) {
    return { rows, columns, totalRows: rows.length };
  }

  const groupKeys = groupBy ?? [];
  const aggs = aggregations ?? [];
  const buckets = new Map<string, Record<string, unknown>[]>();

  for (const row of rows) {
    const key = groupKeys.map((k) => String(row[k] ?? '')).join('\u0001');
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const outColumns: ReportColumn[] = [
    ...groupKeys.map((name) => columns.find((c) => c.name === name) ?? {
      name,
      type: 'string' as const,
      label: name,
    }),
  ];

  for (const agg of aggs) {
    const alias = agg.alias ?? `${agg.type}_${agg.field}`;
    outColumns.push({ name: alias, type: 'number', label: alias });
  }
  if (aggs.length === 0) {
    outColumns.push({ name: 'count', type: 'number', label: 'Count' });
  }

  const outRows: Record<string, unknown>[] = [];
  for (const [, bucket] of buckets) {
    const sample = bucket[0]!;
    const row: Record<string, unknown> = {};
    for (const k of groupKeys) {
      row[k] = sample[k] ?? null;
    }
    if (aggs.length === 0) {
      row['count'] = bucket.length;
    } else {
      for (const agg of aggs) {
        const alias = agg.alias ?? `${agg.type}_${agg.field}`;
        const values = bucket
          .map((r) => Number(r[agg.field]))
          .filter((n) => !Number.isNaN(n));
        switch (agg.type) {
          case 'count':
            row[alias] = bucket.length;
            break;
          case 'sum':
            row[alias] = values.reduce((a, b) => a + b, 0);
            break;
          case 'avg':
            row[alias] =
              values.length === 0
                ? 0
                : values.reduce((a, b) => a + b, 0) / values.length;
            break;
          case 'min':
            row[alias] = values.length === 0 ? null : Math.min(...values);
            break;
          case 'max':
            row[alias] = values.length === 0 ? null : Math.max(...values);
            break;
          default:
            row[alias] = null;
        }
      }
    }
    outRows.push(row);
  }

  return { rows: outRows, columns: outColumns, totalRows: outRows.length };
}

function emptyResult(): ReportDataResult {
  return { rows: [], columns: [], totalRows: 0 };
}

function normalizeReportType(reportType: string): string {
  return reportType.trim().toLowerCase().replace(/-/g, '_');
}

function institutionAllowed(
  institutionId: string,
  areaId: string | undefined,
  userContext: ReportUserContext,
): boolean {
  const scopedInstitutions = userContext.institutionIds ?? [];
  if (scopedInstitutions.length > 0 && !scopedInstitutions.includes(institutionId)) {
    return false;
  }
  const accessibleAreas = userContext.accessibleAreaIds ?? [];
  if (accessibleAreas.length > 0 && areaId && !accessibleAreas.includes(areaId)) {
    return false;
  }
  return true;
}

// ─── Implementation ──────────────────────────────────────────────────────────

export class CrossModuleReportDataSource implements ReportDataSource {
  constructor(private readonly deps: CrossModuleReportDataSourceDeps) {}

  async fetchData(
    tenantId: string,
    reportType: string,
    filters: Record<string, unknown>,
    groupBy: string[] | null,
    aggregations: AggregationConfig[] | null,
    userContext: ReportUserContext,
  ): Promise<ReportDataResult> {
    const type = normalizeReportType(reportType);
    let result: ReportDataResult;

    switch (type) {
      case 'student_enrollment':
      case 'enrollment':
        result = await this.fetchStudentEnrollment(tenantId, filters, userContext);
        break;
      case 'enrollment_summary':
        result = await this.fetchEnrollmentSummary(tenantId, filters, userContext);
        break;
      case 'students':
        result = await this.fetchStudents(tenantId, filters, userContext);
        break;
      case 'attendance_summary':
      case 'attendance':
        result = await this.fetchAttendanceSummary(tenantId, filters, userContext);
        break;
      case 'examination_results':
      case 'examinations':
        result = await this.fetchExaminationResults(tenantId, filters, userContext);
        break;
      case 'scholarship_applications':
      case 'scholarships':
        result = await this.fetchScholarshipApplications(tenantId, filters, userContext);
        break;
      case 'scholarship_utilization':
        result = await this.fetchScholarshipUtilization(tenantId, filters);
        break;
      default:
        return emptyResult();
    }

    return applyGroupByAndAggregations(
      result.rows,
      result.columns,
      groupBy,
      aggregations,
    );
  }

  // ── student_enrollment ───────────────────────────────────────────────────

  private async fetchStudentEnrollment(
    tenantId: string,
    filters: Record<string, unknown>,
    userContext: ReportUserContext,
  ): Promise<ReportDataResult> {
    const { enrollments, students, institutions } = this.deps;
    if (!enrollments || !students || !institutions) return emptyResult();

    const statusFilter = asString(filters['status'])?.toUpperCase() as
      | 'ENROLLED'
      | 'TRANSFERRED'
      | 'WITHDRAWN'
      | 'GRADUATED'
      | undefined;
    const institutionId = asString(filters['institutionId']);
    const academicPeriodId = asString(filters['academicPeriodId']);

    const enrollmentRows = await collectAllPages((page, pageSize) =>
      enrollments.listEnrollments(
        tenantId,
        {
          institutionId,
          academicPeriodId,
          status: statusFilter,
        },
        { page, pageSize },
      ),
    );

    const institutionCache = new Map<string, ReportInstitutionRow | null>();
    const studentCache = new Map<string, ReportStudentRow | null>();

    const resolveInstitution = async (id: string) => {
      if (institutionCache.has(id)) return institutionCache.get(id)!;
      const row = await institutions.findById(id, tenantId);
      institutionCache.set(id, row);
      return row;
    };

    const resolveStudent = async (id: string) => {
      if (studentCache.has(id)) return studentCache.get(id)!;
      let row: ReportStudentRow | null = null;
      if (students.findById) {
        row = await students.findById(id, tenantId);
      } else {
        // Fallback: page students once and index (rare path)
        if (studentCache.size === 0) {
          const all = await collectAllPages((page, pageSize) =>
            students.list(tenantId, {}, { page, pageSize }),
          );
          for (const s of all) studentCache.set(s.id, s);
        }
        row = studentCache.get(id) ?? null;
      }
      studentCache.set(id, row);
      return row;
    };

    const rows: Record<string, unknown>[] = [];
    for (const enrollment of enrollmentRows) {
      const institution = await resolveInstitution(enrollment.institutionId);
      if (
        !institutionAllowed(
          enrollment.institutionId,
          institution?.areaId,
          userContext,
        )
      ) {
        continue;
      }
      const student = await resolveStudent(enrollment.studentId);
      rows.push({
        enrollmentId: enrollment.id,
        studentId: enrollment.studentId,
        studentName: student
          ? `${student.firstName} ${student.lastName}`.trim()
          : null,
        gender: student?.gender ?? null,
        institutionId: enrollment.institutionId,
        institutionName: institution?.name ?? null,
        institutionCode: institution?.code ?? null,
        areaId: institution?.areaId ?? null,
        gradeId: enrollment.gradeId,
        classId: enrollment.classId,
        academicPeriodId: enrollment.academicPeriodId,
        status: enrollment.status,
        enrolledAt: enrollment.enrolledAt.toISOString(),
        exitedAt: enrollment.exitedAt?.toISOString() ?? null,
      });
    }

    const columns: ReportColumn[] = [
      { name: 'enrollmentId', type: 'string', label: 'Enrollment ID' },
      { name: 'studentId', type: 'string', label: 'Student ID' },
      { name: 'studentName', type: 'string', label: 'Student' },
      { name: 'gender', type: 'string', label: 'Gender' },
      { name: 'institutionId', type: 'string', label: 'Institution ID' },
      { name: 'institutionName', type: 'string', label: 'Institution' },
      { name: 'institutionCode', type: 'string', label: 'Institution Code' },
      { name: 'areaId', type: 'string', label: 'Area ID' },
      { name: 'gradeId', type: 'string', label: 'Grade ID' },
      { name: 'classId', type: 'string', label: 'Class ID' },
      { name: 'academicPeriodId', type: 'string', label: 'Academic Period' },
      { name: 'status', type: 'string', label: 'Status' },
      { name: 'enrolledAt', type: 'date', label: 'Enrolled At' },
      { name: 'exitedAt', type: 'date', label: 'Exited At' },
    ];

    return { rows, columns, totalRows: rows.length };
  }

  // ── enrollment_summary ─────────────────────────────────────────────────

  /**
   * Aggregate enrollments by institution / status / grade in application memory
   * (sequential per-schema reads + UUID joins — no cross-schema SQL).
   */
  private async fetchEnrollmentSummary(
    tenantId: string,
    filters: Record<string, unknown>,
    userContext: ReportUserContext,
  ): Promise<ReportDataResult> {
    const { enrollments, institutions } = this.deps;
    if (!enrollments) return emptyResult();

    const statusFilter = asString(filters['status'])?.toUpperCase() as
      | 'ENROLLED'
      | 'TRANSFERRED'
      | 'WITHDRAWN'
      | 'GRADUATED'
      | undefined;
    const institutionId = asString(filters['institutionId']);
    const academicPeriodId = asString(filters['academicPeriodId']);

    const enrollmentRows = await collectAllPages((page, pageSize) =>
      enrollments.listEnrollments(
        tenantId,
        {
          institutionId,
          academicPeriodId,
          status: statusFilter,
        },
        { page, pageSize },
      ),
    );

    const institutionCache = new Map<string, ReportInstitutionRow | null>();
    const buckets = new Map<
      string,
      {
        institutionId: string;
        institutionName: string | null;
        status: string;
        gradeId: string;
        count: number;
      }
    >();

    for (const enrollment of enrollmentRows) {
      let institution: ReportInstitutionRow | null | undefined =
        institutionCache.get(enrollment.institutionId);
      if (institution === undefined && institutions) {
        institution = await institutions.findById(enrollment.institutionId, tenantId);
        institutionCache.set(enrollment.institutionId, institution);
      }
      if (
        !institutionAllowed(
          enrollment.institutionId,
          institution?.areaId,
          userContext,
        )
      ) {
        continue;
      }

      const key = `${enrollment.institutionId}\u0001${enrollment.status}\u0001${enrollment.gradeId}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        buckets.set(key, {
          institutionId: enrollment.institutionId,
          institutionName: institution?.name ?? null,
          status: enrollment.status,
          gradeId: enrollment.gradeId,
          count: 1,
        });
      }
    }

    const rows: Record<string, unknown>[] = [...buckets.values()].map((b) => ({
      institutionId: b.institutionId,
      institutionName: b.institutionName,
      status: b.status,
      gradeId: b.gradeId,
      enrollmentCount: b.count,
    }));

    const columns: ReportColumn[] = [
      { name: 'institutionId', type: 'string', label: 'Institution ID' },
      { name: 'institutionName', type: 'string', label: 'Institution' },
      { name: 'status', type: 'string', label: 'Status' },
      { name: 'gradeId', type: 'string', label: 'Grade ID' },
      { name: 'enrollmentCount', type: 'number', label: 'Enrollments' },
    ];

    return { rows, columns, totalRows: rows.length };
  }

  // ── students ─────────────────────────────────────────────────────────────

  private async fetchStudents(
    tenantId: string,
    filters: Record<string, unknown>,
    userContext: ReportUserContext,
  ): Promise<ReportDataResult> {
    const { students, enrollments, institutions } = this.deps;
    if (!students) return emptyResult();

    const gender = asString(filters['gender']);
    const search = asString(filters['search']);

    const studentRows = await collectAllPages((page, pageSize) =>
      students.list(tenantId, { gender, search }, { page, pageSize }),
    );

    // Optional RBAC via active enrollments → institution → area
    let allowedStudentIds: Set<string> | null = null;
    if (
      (userContext.institutionIds?.length || userContext.accessibleAreaIds?.length) &&
      enrollments &&
      institutions
    ) {
      const enrollmentRows = await collectAllPages((page, pageSize) =>
        enrollments.listEnrollments(tenantId, { status: 'ENROLLED' }, { page, pageSize }),
      );
      allowedStudentIds = new Set<string>();
      const institutionCache = new Map<string, ReportInstitutionRow | null>();
      for (const enrollment of enrollmentRows) {
        let institution = institutionCache.get(enrollment.institutionId);
        if (institution === undefined) {
          institution = await institutions.findById(enrollment.institutionId, tenantId);
          institutionCache.set(enrollment.institutionId, institution);
        }
        if (
          institutionAllowed(
            enrollment.institutionId,
            institution?.areaId,
            userContext,
          )
        ) {
          allowedStudentIds.add(enrollment.studentId);
        }
      }
    }

    const rows: Record<string, unknown>[] = [];
    for (const student of studentRows) {
      if (allowedStudentIds && !allowedStudentIds.has(student.id)) continue;
      rows.push({
        studentId: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        fullName: `${student.firstName} ${student.lastName}`.trim(),
        gender: student.gender,
        dateOfBirth: student.dateOfBirth,
        nationalId: student.nationalId,
      });
    }

    const columns: ReportColumn[] = [
      { name: 'studentId', type: 'string', label: 'Student ID' },
      { name: 'firstName', type: 'string', label: 'First Name' },
      { name: 'lastName', type: 'string', label: 'Last Name' },
      { name: 'fullName', type: 'string', label: 'Full Name' },
      { name: 'gender', type: 'string', label: 'Gender' },
      { name: 'dateOfBirth', type: 'date', label: 'Date of Birth' },
      { name: 'nationalId', type: 'string', label: 'National ID' },
    ];

    return { rows, columns, totalRows: rows.length };
  }

  // ── attendance_summary ───────────────────────────────────────────────────

  private async fetchAttendanceSummary(
    tenantId: string,
    filters: Record<string, unknown>,
    userContext: ReportUserContext,
  ): Promise<ReportDataResult> {
    const { attendance, students, institutions } = this.deps;
    if (!attendance) return emptyResult();

    const today = new Date().toISOString().slice(0, 10);
    const startDate = asIsoDate(filters['startDate'] ?? filters['from'], today);
    const endDate = asIsoDate(filters['endDate'] ?? filters['to'] ?? filters['period'], today);
    const classId = asString(filters['classId']);
    const studentId = asString(filters['studentId']);
    const filterInstitutionId = asString(filters['institutionId']);

    const institutionIds: string[] = [];
    if (filterInstitutionId) {
      institutionIds.push(filterInstitutionId);
    } else if (userContext.institutionIds?.length) {
      institutionIds.push(...userContext.institutionIds);
    }

    const attendanceRows: ReportAttendanceRow[] = [];

    if (studentId && classId) {
      attendanceRows.push(
        ...(await attendance.listStudentAttendanceByDateRange(tenantId, {
          scope: 'student',
          studentId,
          classId,
          startDate,
          endDate,
        })),
      );
    } else if (classId) {
      attendanceRows.push(
        ...(await attendance.listStudentAttendanceByDateRange(tenantId, {
          scope: 'class',
          classId,
          startDate,
          endDate,
        })),
      );
    } else if (institutionIds.length > 0) {
      for (const institutionId of institutionIds) {
        attendanceRows.push(
          ...(await attendance.listStudentAttendanceByDateRange(tenantId, {
            scope: 'institution',
            institutionId,
            startDate,
            endDate,
          })),
        );
      }
    } else {
      // No institution scope available — return empty rather than unbounded scan
      return emptyResult();
    }

    const studentCache = new Map<string, ReportStudentRow | null>();
    const institutionCache = new Map<string, ReportInstitutionRow | null>();

    const rows: Record<string, unknown>[] = [];
    for (const record of attendanceRows) {
      let institution: ReportInstitutionRow | null | undefined =
        institutionCache.get(record.institutionId);
      if (institution === undefined && institutions) {
        institution = await institutions.findById(record.institutionId, tenantId);
        institutionCache.set(record.institutionId, institution);
      }
      if (
        !institutionAllowed(
          record.institutionId,
          institution?.areaId,
          userContext,
        )
      ) {
        continue;
      }

      let student: ReportStudentRow | null | undefined = studentCache.get(record.studentId);
      if (student === undefined && students?.findById) {
        student = await students.findById(record.studentId, tenantId);
        studentCache.set(record.studentId, student);
      }

      rows.push({
        attendanceId: record.id,
        studentId: record.studentId,
        studentName: student
          ? `${student.firstName} ${student.lastName}`.trim()
          : null,
        institutionId: record.institutionId,
        institutionName: institution?.name ?? null,
        areaId: institution?.areaId ?? null,
        classId: record.classId,
        academicPeriodId: record.academicPeriodId,
        date: record.date,
        status: record.status,
        subjectId: record.subjectId,
        periodId: record.periodId,
        presentFlag:
          record.status === 'PRESENT' || record.status === 'LATE' ? 1 : 0,
      });
    }

    const columns: ReportColumn[] = [
      { name: 'attendanceId', type: 'string', label: 'Attendance ID' },
      { name: 'studentId', type: 'string', label: 'Student ID' },
      { name: 'studentName', type: 'string', label: 'Student' },
      { name: 'institutionId', type: 'string', label: 'Institution ID' },
      { name: 'institutionName', type: 'string', label: 'Institution' },
      { name: 'areaId', type: 'string', label: 'Area ID' },
      { name: 'classId', type: 'string', label: 'Class ID' },
      { name: 'academicPeriodId', type: 'string', label: 'Academic Period' },
      { name: 'date', type: 'date', label: 'Date' },
      { name: 'status', type: 'string', label: 'Status' },
      { name: 'subjectId', type: 'string', label: 'Subject ID' },
      { name: 'periodId', type: 'string', label: 'Period ID' },
      { name: 'presentFlag', type: 'number', label: 'Present' },
    ];

    return { rows, columns, totalRows: rows.length };
  }

  // ── examination_results ──────────────────────────────────────────────────

  private async fetchExaminationResults(
    tenantId: string,
    filters: Record<string, unknown>,
    _userContext: ReportUserContext,
  ): Promise<ReportDataResult> {
    const { examinations, examinationResults, students } = this.deps;
    if (!examinations || !examinationResults) return emptyResult();

    const examinationIdFilter = asString(filters['examinationId']);
    const academicPeriodId = asString(filters['academicPeriodId']);
    const status = asString(filters['status']);

    let examList: ReportExaminationRow[];
    if (examinationIdFilter) {
      const all = await collectAllPages((page, pageSize) =>
        examinations.list(tenantId, { academicPeriodId, status }, { page, pageSize }),
      );
      examList = all.filter((e) => e.id === examinationIdFilter);
    } else {
      examList = await collectAllPages((page, pageSize) =>
        examinations.list(tenantId, { academicPeriodId, status }, { page, pageSize }),
      );
    }

    const studentCache = new Map<string, ReportStudentRow | null>();
    const rows: Record<string, unknown>[] = [];

    for (const exam of examList) {
      const publication = await examinationResults.getPublicationResult(
        exam.id,
        tenantId,
      );
      if (!publication) continue;

      for (const grade of publication.gradeResults) {
        let student: ReportStudentRow | null | undefined = studentCache.get(
          grade.studentId,
        );
        if (student === undefined && students?.findById) {
          student = await students.findById(grade.studentId, tenantId);
          studentCache.set(grade.studentId, student);
        }

        rows.push({
          examinationId: exam.id,
          examinationName: exam.name,
          examinationCode: exam.code,
          academicPeriodId: exam.academicPeriodId,
          publishedAt: publication.publishedAt.toISOString(),
          candidateId: grade.candidateId,
          studentId: grade.studentId,
          studentName: student
            ? `${student.firstName} ${student.lastName}`.trim()
            : null,
          subjectId: grade.subjectId,
          score: grade.score,
          grade: grade.grade,
          passed: grade.passed,
        });
      }
    }

    const columns: ReportColumn[] = [
      { name: 'examinationId', type: 'string', label: 'Examination ID' },
      { name: 'examinationName', type: 'string', label: 'Examination' },
      { name: 'examinationCode', type: 'string', label: 'Code' },
      { name: 'academicPeriodId', type: 'string', label: 'Academic Period' },
      { name: 'publishedAt', type: 'date', label: 'Published At' },
      { name: 'candidateId', type: 'string', label: 'Candidate ID' },
      { name: 'studentId', type: 'string', label: 'Student ID' },
      { name: 'studentName', type: 'string', label: 'Student' },
      { name: 'subjectId', type: 'string', label: 'Subject ID' },
      { name: 'score', type: 'number', label: 'Score' },
      { name: 'grade', type: 'string', label: 'Grade' },
      { name: 'passed', type: 'boolean', label: 'Passed' },
    ];

    return { rows, columns, totalRows: rows.length };
  }

  // ── scholarship_applications ─────────────────────────────────────────────

  private async fetchScholarshipApplications(
    tenantId: string,
    filters: Record<string, unknown>,
    userContext: ReportUserContext,
  ): Promise<ReportDataResult> {
    const { scholarships, institutions, students } = this.deps;
    if (!scholarships) return emptyResult();

    const programId = asString(filters['programId']);
    const institutionId = asString(filters['institutionId']);
    const status = asString(filters['status']);
    const areaId = asString(filters['areaId']);
    const gender = asString(filters['gender']);

    const applications = await collectAllPages((page, pageSize) =>
      scholarships.listApplications(
        tenantId,
        { programId, institutionId, status, areaId, gender },
        { page, pageSize },
      ),
    );

    const programs = await collectAllPages((page, pageSize) =>
      scholarships.listPrograms(tenantId, {}, { page, pageSize }),
    );
    const programById = new Map(programs.map((p) => [p.id, p]));

    const institutionCache = new Map<string, ReportInstitutionRow | null>();
    const studentCache = new Map<string, ReportStudentRow | null>();

    const rows: Record<string, unknown>[] = [];
    for (const app of applications) {
      let institution: ReportInstitutionRow | null | undefined =
        institutionCache.get(app.institutionId);
      if (institution === undefined && institutions) {
        institution = await institutions.findById(app.institutionId, tenantId);
        institutionCache.set(app.institutionId, institution);
      }
      const effectiveAreaId = app.areaId ?? institution?.areaId;
      if (
        !institutionAllowed(app.institutionId, effectiveAreaId ?? undefined, userContext)
      ) {
        continue;
      }

      let student: ReportStudentRow | null | undefined = studentCache.get(
        app.applicantId,
      );
      if (student === undefined && students?.findById) {
        student = await students.findById(app.applicantId, tenantId);
        studentCache.set(app.applicantId, student);
      }

      const program = programById.get(app.programId);
      rows.push({
        applicationId: app.id,
        programId: app.programId,
        programName: program?.name ?? null,
        applicantId: app.applicantId,
        applicantName: student
          ? `${student.firstName} ${student.lastName}`.trim()
          : null,
        institutionId: app.institutionId,
        institutionName: institution?.name ?? null,
        areaId: effectiveAreaId ?? null,
        status: app.status,
        gender: app.gender ?? student?.gender ?? null,
        amountPerRecipient: program?.amountPerRecipient ?? null,
        currency: program?.currency ?? null,
        submittedAt: app.submittedAt.toISOString(),
      });
    }

    const columns: ReportColumn[] = [
      { name: 'applicationId', type: 'string', label: 'Application ID' },
      { name: 'programId', type: 'string', label: 'Program ID' },
      { name: 'programName', type: 'string', label: 'Program' },
      { name: 'applicantId', type: 'string', label: 'Applicant ID' },
      { name: 'applicantName', type: 'string', label: 'Applicant' },
      { name: 'institutionId', type: 'string', label: 'Institution ID' },
      { name: 'institutionName', type: 'string', label: 'Institution' },
      { name: 'areaId', type: 'string', label: 'Area ID' },
      { name: 'status', type: 'string', label: 'Status' },
      { name: 'gender', type: 'string', label: 'Gender' },
      { name: 'amountPerRecipient', type: 'number', label: 'Amount' },
      { name: 'currency', type: 'string', label: 'Currency' },
      { name: 'submittedAt', type: 'date', label: 'Submitted At' },
    ];

    return { rows, columns, totalRows: rows.length };
  }

  // ── scholarship_utilization ──────────────────────────────────────────────

  private async fetchScholarshipUtilization(
    tenantId: string,
    filters: Record<string, unknown>,
  ): Promise<ReportDataResult> {
    const { scholarships } = this.deps;
    if (!scholarships?.getUtilizationReport) return emptyResult();

    const groupByRaw = asString(filters['groupBy']);
    const groupBy =
      groupByRaw === 'program' ||
      groupByRaw === 'area' ||
      groupByRaw === 'gender' ||
      groupByRaw === 'institution'
        ? groupByRaw
        : undefined;

    const data = await scholarships.getUtilizationReport(tenantId, {
      programId: asString(filters['programId']),
      areaId: asString(filters['areaId']),
      gender: asString(filters['gender']),
      institutionId: asString(filters['institutionId']),
      startDate: asString(filters['startDate']),
      endDate: asString(filters['endDate']),
      groupBy,
    });

    const rows: Record<string, unknown>[] = data.breakdown.map((item) => ({
      groupKey: item.groupKey,
      groupValue: item.groupValue,
      applicationCount: item.applicationCount,
      approvedCount: item.approvedCount,
      disbursedAmount: item.disbursedAmount,
      utilizationRate: item.utilizationRate,
      totalPrograms: data.totalPrograms,
      totalApplications: data.totalApplications,
      totalApproved: data.totalApproved,
      totalDisbursed: data.totalDisbursed,
      totalAmount: data.totalAmount,
      currency: data.currency,
    }));

    // When breakdown is empty but totals exist, surface a single summary row
    if (rows.length === 0 && data.totalPrograms + data.totalApplications > 0) {
      rows.push({
        groupKey: 'all',
        groupValue: 'all',
        applicationCount: data.totalApplications,
        approvedCount: data.totalApproved,
        disbursedAmount: data.totalDisbursed,
        utilizationRate:
          data.totalAmount > 0 ? data.totalDisbursed / data.totalAmount : 0,
        totalPrograms: data.totalPrograms,
        totalApplications: data.totalApplications,
        totalApproved: data.totalApproved,
        totalDisbursed: data.totalDisbursed,
        totalAmount: data.totalAmount,
        currency: data.currency,
      });
    }

    const columns: ReportColumn[] = [
      { name: 'groupKey', type: 'string', label: 'Group Key' },
      { name: 'groupValue', type: 'string', label: 'Group Value' },
      { name: 'applicationCount', type: 'number', label: 'Applications' },
      { name: 'approvedCount', type: 'number', label: 'Approved' },
      { name: 'disbursedAmount', type: 'number', label: 'Disbursed' },
      { name: 'utilizationRate', type: 'number', label: 'Utilization Rate' },
      { name: 'totalPrograms', type: 'number', label: 'Total Programs' },
      { name: 'totalApplications', type: 'number', label: 'Total Applications' },
      { name: 'totalApproved', type: 'number', label: 'Total Approved' },
      { name: 'totalDisbursed', type: 'number', label: 'Total Disbursed' },
      { name: 'totalAmount', type: 'number', label: 'Total Amount' },
      { name: 'currency', type: 'string', label: 'Currency' },
    ];

    return { rows, columns, totalRows: rows.length };
  }
}

/**
 * Factory for the cross-module analytical data source.
 */
export function createReportDataSource(
  deps: CrossModuleReportDataSourceDeps = {},
): ReportDataSource {
  return new CrossModuleReportDataSource(deps);
}
