/**
 * Unit tests for CrossModuleReportDataSource — sequential per-schema reads
 * composed in memory by UUID (no cross-schema SQL).
 */
import { describe, it, expect } from 'vitest';

import {
  CrossModuleReportDataSource,
  type CrossModuleReportDataSourceDeps,
  type ReportEnrollmentRow,
  type ReportInstitutionRow,
  type ReportStudentRow,
  type ReportAttendanceRow,
  type ReportScholarshipApplicationRow,
  type ReportScholarshipProgramRow,
  type ReportPage,
} from './cross-module-report-data-source.js';
import type { ReportUserContext } from './report-repository.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const AREA_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const AREA_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INST_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INST_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STUDENT_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const STUDENT_2 = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function pageOf<T>(data: T[]): ReportPage<T> {
  return {
    data,
    meta: {
      page: 1,
      pageSize: data.length || 1,
      totalItems: data.length,
      totalPages: 1,
    },
  };
}

function userContext(overrides?: Partial<ReportUserContext>): ReportUserContext {
  return {
    userId: '22222222-2222-4222-8222-222222222222',
    tenantId: TENANT,
    roleId: 'admin',
    areaId: AREA_A,
    institutionIds: [INST_A],
    accessibleAreaIds: [AREA_A],
    ...overrides,
  };
}

const students: ReportStudentRow[] = [
  {
    id: STUDENT_1,
    firstName: 'Ada',
    lastName: 'Lovelace',
    gender: 'female',
    dateOfBirth: '2008-01-01',
    nationalId: null,
  },
  {
    id: STUDENT_2,
    firstName: 'Alan',
    lastName: 'Turing',
    gender: 'male',
    dateOfBirth: '2007-06-15',
    nationalId: 'N-1',
  },
];

const institutions: ReportInstitutionRow[] = [
  {
    id: INST_A,
    name: 'North School',
    code: 'NS',
    areaId: AREA_A,
    status: 'ACTIVE',
  },
  {
    id: INST_B,
    name: 'South School',
    code: 'SS',
    areaId: AREA_B,
    status: 'ACTIVE',
  },
];

const enrollments: ReportEnrollmentRow[] = [
  {
    id: '11111111-1111-4111-8111-111111111101',
    studentId: STUDENT_1,
    institutionId: INST_A,
    gradeId: 'grade-1',
    classId: 'class-1',
    academicPeriodId: 'period-1',
    status: 'ENROLLED',
    enrolledAt: new Date('2024-09-01'),
    exitedAt: null,
  },
  {
    id: '11111111-1111-4111-8111-111111111102',
    studentId: STUDENT_2,
    institutionId: INST_B,
    gradeId: 'grade-1',
    classId: 'class-2',
    academicPeriodId: 'period-1',
    status: 'ENROLLED',
    enrolledAt: new Date('2024-09-01'),
    exitedAt: null,
  },
];

function buildDeps(
  overrides?: Partial<CrossModuleReportDataSourceDeps>,
): CrossModuleReportDataSourceDeps {
  return {
    students: {
      list: async () => pageOf(students),
      findById: async (id) => students.find((s) => s.id === id) ?? null,
    },
    enrollments: {
      listEnrollments: async (_t, filter) =>
        pageOf(
          enrollments.filter((e) => {
            if (filter.institutionId && e.institutionId !== filter.institutionId) {
              return false;
            }
            if (filter.status && e.status !== filter.status) return false;
            return true;
          }),
        ),
    },
    institutions: {
      list: async () => pageOf(institutions),
      findById: async (id) => institutions.find((i) => i.id === id) ?? null,
    },
    attendance: {
      listStudentAttendanceByDateRange: async (_t, query) => {
        const rows: ReportAttendanceRow[] = [
          {
            id: 'att-1',
            studentId: STUDENT_1,
            institutionId: INST_A,
            classId: 'class-1',
            academicPeriodId: 'period-1',
            date: '2024-10-01',
            status: 'PRESENT',
            subjectId: null,
            periodId: null,
          },
          {
            id: 'att-2',
            studentId: STUDENT_2,
            institutionId: INST_B,
            classId: 'class-2',
            academicPeriodId: 'period-1',
            date: '2024-10-01',
            status: 'ABSENT',
            subjectId: null,
            periodId: null,
          },
        ];
        if (query.scope === 'institution' && query.institutionId) {
          return rows.filter((r) => r.institutionId === query.institutionId);
        }
        return rows;
      },
    },
    scholarships: {
      listApplications: async () => {
        const apps: ReportScholarshipApplicationRow[] = [
          {
            id: 'app-1',
            programId: 'prog-1',
            applicantId: STUDENT_1,
            institutionId: INST_A,
            status: 'approved',
            areaId: AREA_A,
            gender: 'female',
            submittedAt: new Date('2024-08-01'),
          },
        ];
        return pageOf(apps);
      },
      listPrograms: async () => {
        const programs: ReportScholarshipProgramRow[] = [
          {
            id: 'prog-1',
            name: 'Merit Grant',
            status: 'open',
            amountPerRecipient: 1000,
            currency: 'USD',
            totalSlots: 10,
            usedSlots: 1,
          },
        ];
        return pageOf(programs);
      },
      getUtilizationReport: async () => ({
        totalPrograms: 1,
        totalApplications: 1,
        totalApproved: 1,
        totalDisbursed: 500,
        totalAmount: 1000,
        currency: 'USD',
        breakdown: [
          {
            groupKey: 'program',
            groupValue: 'Merit Grant',
            applicationCount: 1,
            approvedCount: 1,
            disbursedAmount: 500,
            utilizationRate: 0.5,
          },
        ],
      }),
    },
    ...overrides,
  };
}

describe('CrossModuleReportDataSource', () => {
  it('joins enrollments with students and institutions in memory by UUID', async () => {
    const ds = new CrossModuleReportDataSource(buildDeps());
    const result = await ds.fetchData(
      TENANT,
      'student_enrollment',
      {},
      null,
      null,
      userContext({ institutionIds: [INST_A, INST_B], accessibleAreaIds: [AREA_A, AREA_B] }),
    );

    expect(result.totalRows).toBe(2);
    expect(result.rows[0]).toMatchObject({
      studentName: 'Ada Lovelace',
      institutionName: 'North School',
      status: 'ENROLLED',
    });
    expect(result.columns.some((c) => c.name === 'studentName')).toBe(true);
  });

  it('applies RBAC institution scoping', async () => {
    const ds = new CrossModuleReportDataSource(buildDeps());
    const result = await ds.fetchData(
      TENANT,
      'student_enrollment',
      {},
      null,
      null,
      userContext({ institutionIds: [INST_A], accessibleAreaIds: [AREA_A] }),
    );

    expect(result.totalRows).toBe(1);
    expect(result.rows[0]!['institutionId']).toBe(INST_A);
  });

  it('returns empty rows when no matching data', async () => {
    const ds = new CrossModuleReportDataSource(
      buildDeps({
        enrollments: {
          listEnrollments: async () => pageOf([]),
        },
      }),
    );
    const result = await ds.fetchData(
      TENANT,
      'student_enrollment',
      {},
      null,
      null,
      userContext(),
    );
    expect(result.rows).toEqual([]);
    expect(result.totalRows).toBe(0);
    expect(result.columns.length).toBeGreaterThan(0);
  });

  it('returns empty for unknown report types', async () => {
    const ds = new CrossModuleReportDataSource(buildDeps());
    const result = await ds.fetchData(
      TENANT,
      'unknown_report',
      {},
      null,
      null,
      userContext(),
    );
    expect(result).toEqual({ rows: [], columns: [], totalRows: 0 });
  });

  it('builds attendance_summary with student enrichment', async () => {
    const ds = new CrossModuleReportDataSource(buildDeps());
    const result = await ds.fetchData(
      TENANT,
      'attendance_summary',
      { institutionId: INST_A, startDate: '2024-10-01', endDate: '2024-10-31' },
      null,
      null,
      userContext(),
    );

    expect(result.totalRows).toBe(1);
    expect(result.rows[0]).toMatchObject({
      studentName: 'Ada Lovelace',
      status: 'PRESENT',
      presentFlag: 1,
    });
  });

  it('supports scholarship_applications and utilization', async () => {
    const ds = new CrossModuleReportDataSource(buildDeps());
    const apps = await ds.fetchData(
      TENANT,
      'scholarship_applications',
      {},
      null,
      null,
      userContext(),
    );
    expect(apps.totalRows).toBe(1);
    expect(apps.rows[0]).toMatchObject({
      programName: 'Merit Grant',
      applicantName: 'Ada Lovelace',
    });

    const util = await ds.fetchData(
      TENANT,
      'scholarship_utilization',
      {},
      null,
      null,
      userContext(),
    );
    expect(util.totalRows).toBe(1);
    expect(util.rows[0]!['disbursedAmount']).toBe(500);
  });

  it('applies groupBy and aggregations in memory', async () => {
    const ds = new CrossModuleReportDataSource(buildDeps());
    const result = await ds.fetchData(
      TENANT,
      'student_enrollment',
      {},
      ['status'],
      [{ field: 'studentId', type: 'count', alias: 'enrollment_count' }],
      userContext({ institutionIds: [INST_A, INST_B], accessibleAreaIds: [AREA_A, AREA_B] }),
    );

    expect(result.totalRows).toBe(1);
    expect(result.rows[0]).toMatchObject({
      status: 'ENROLLED',
      enrollment_count: 2,
    });
  });
});
