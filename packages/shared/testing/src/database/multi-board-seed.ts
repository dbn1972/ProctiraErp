/**
 * Multi-board / multi-school onboarding seed for enterprise production certification.
 *
 * Default profile (override via options / CLI):
 *   3 boards × 2 schools × 500 students = 3,000 enrollments
 *
 * In-memory by default (no DATABASE_URL). When DATABASE_URL is set, a future
 * Prisma adapter can persist the same graph — see tools/scripts/onboard-boards-schools.mjs.
 */

import { createAcademicPeriod } from '../factories/academic-period.factory.js';
import { createAreaHierarchy } from '../factories/area.factory.js';
import { createBoard } from '../factories/board.factory.js';
import { createEnrollment } from '../factories/enrollment.factory.js';
import { createInstitution } from '../factories/institution.factory.js';
import { createStaff } from '../factories/staff.factory.js';
import { createStudentList } from '../factories/student.factory.js';
import { createTenant } from '../factories/tenant.factory.js';
import type {
  AcademicPeriod,
  Area,
  Board,
  BoardType,
  Enrollment,
  Institution,
  Staff,
  Student,
  Tenant,
} from '../factories/types.js';

export interface BoardSchoolSeedSpec {
  boardCode: string;
  boardName: string;
  boardType: BoardType;
  schools: Array<{ code: string; name: string }>;
}

export interface MultiBoardSeedOptions {
  /** Students per school (default: 500). */
  studentsPerSchool?: number;
  /** Staff per school (default: 25). */
  staffPerSchool?: number;
  /** Area hierarchy depth (default: 4). */
  areaDepth?: number;
  /** Tenant overrides. */
  tenantOverrides?: Partial<Tenant>;
  /**
   * Explicit board/school graph. When omitted, uses the default 3×2 certification profile.
   */
  boards?: BoardSchoolSeedSpec[];
}

export interface SchoolSeedBundle {
  board: Board;
  institution: Institution;
  academicPeriod: AcademicPeriod;
  students: Student[];
  staff: Staff[];
  enrollments: Enrollment[];
}

export interface MultiBoardSeedResult {
  tenant: Tenant;
  areas: Area[];
  boards: Board[];
  schools: SchoolSeedBundle[];
  totals: {
    boardCount: number;
    schoolCount: number;
    studentCount: number;
    staffCount: number;
    enrollmentCount: number;
  };
}

/** Default enterprise certification profile: 3 boards, 2 schools each, 500 students/school. */
export const DEFAULT_MULTI_BOARD_PROFILE: BoardSchoolSeedSpec[] = [
  {
    boardCode: 'CBSE',
    boardName: 'Central Board of Secondary Education',
    boardType: 'NATIONAL',
    schools: [
      { code: 'CBSE-DEL-01', name: 'Proctira Model School Delhi' },
      { code: 'CBSE-NOI-02', name: 'Proctira International School Noida' },
    ],
  },
  {
    boardCode: 'MH-STATE',
    boardName: 'Maharashtra State Board',
    boardType: 'STATE',
    schools: [
      { code: 'MH-PUN-01', name: 'Proctira Vidyalaya Pune' },
      { code: 'MH-MUM-02', name: 'Proctira High School Mumbai' },
    ],
  },
  {
    boardCode: 'ICSE',
    boardName: 'Council for the Indian School Certificate Examinations',
    boardType: 'PRIVATE',
    schools: [
      { code: 'ICSE-BLR-01', name: 'Proctira Academy Bengaluru' },
      { code: 'ICSE-HYD-02', name: 'Proctira Convent Hyderabad' },
    ],
  },
];

/**
 * Seeds a tenant with multiple education boards and schools, each with a full
 * student roster suitable for production-readiness volume tests.
 */
export function seedMultiBoardSchools(
  options: MultiBoardSeedOptions = {},
): MultiBoardSeedResult {
  const {
    studentsPerSchool = 500,
    staffPerSchool = 25,
    areaDepth = 4,
    tenantOverrides = {},
    boards: boardSpecs = DEFAULT_MULTI_BOARD_PROFILE,
  } = options;

  if (studentsPerSchool < 1) {
    throw new Error('studentsPerSchool must be >= 1');
  }
  if (boardSpecs.length < 1) {
    throw new Error('At least one board is required');
  }

  const tenant = createTenant({
    name: 'Proctira Multi-Board Certification Tenant',
    slug: 'proctira-multiboard-cert',
    ...tenantOverrides,
  });

  const areas = createAreaHierarchy(tenant.id, areaDepth);
  const leafArea = areas[areas.length - 1]!;

  const boards: Board[] = [];
  const schools: SchoolSeedBundle[] = [];

  for (const spec of boardSpecs) {
    const board = createBoard({
      tenantId: tenant.id,
      code: spec.boardCode,
      name: spec.boardName,
      type: spec.boardType,
      status: 'active',
    });
    boards.push(board);

    for (const schoolSpec of spec.schools) {
      const institution = createInstitution({
        tenantId: tenant.id,
        boardId: board.id,
        areaId: leafArea.id,
        code: schoolSpec.code,
        name: schoolSpec.name,
        status: 'ACTIVE',
        customData: {
          boardCode: board.code,
          certificationSeed: true,
        },
      });

      const academicPeriod = createAcademicPeriod({
        tenantId: tenant.id,
        institutionId: institution.id,
        status: 'ACTIVE',
        name: 'AY 2026-27',
        code: `AY26-${schoolSpec.code}`,
      });

      const students = createStudentList(studentsPerSchool, {
        tenantId: tenant.id,
        customData: {
          institutionCode: institution.code,
          boardCode: board.code,
        },
      });

      const staff = Array.from({ length: staffPerSchool }, () =>
        createStaff({
          tenantId: tenant.id,
          customData: { institutionCode: institution.code },
        }),
      );

      const enrollments = students.map((student) =>
        createEnrollment({
          tenantId: tenant.id,
          studentId: student.id,
          institutionId: institution.id,
          academicPeriodId: academicPeriod.id,
          status: 'ENROLLED',
        }),
      );

      schools.push({
        board,
        institution,
        academicPeriod,
        students,
        staff,
        enrollments,
      });
    }
  }

  const studentCount = schools.reduce((n, s) => n + s.students.length, 0);
  const staffCount = schools.reduce((n, s) => n + s.staff.length, 0);
  const enrollmentCount = schools.reduce((n, s) => n + s.enrollments.length, 0);

  return {
    tenant,
    areas,
    boards,
    schools,
    totals: {
      boardCount: boards.length,
      schoolCount: schools.length,
      studentCount,
      staffCount,
      enrollmentCount,
    },
  };
}

/**
 * Asserts structural invariants for a multi-board seed (used by Vitest + CLI).
 */
export function assertMultiBoardSeedInvariants(
  result: MultiBoardSeedResult,
  expected: { boards: number; schools: number; studentsPerSchool: number },
): void {
  if (result.totals.boardCount !== expected.boards) {
    throw new Error(
      `Expected ${expected.boards} boards, got ${result.totals.boardCount}`,
    );
  }
  if (result.totals.schoolCount !== expected.schools) {
    throw new Error(
      `Expected ${expected.schools} schools, got ${result.totals.schoolCount}`,
    );
  }
  const expectedStudents = expected.schools * expected.studentsPerSchool;
  if (result.totals.studentCount !== expectedStudents) {
    throw new Error(
      `Expected ${expectedStudents} students, got ${result.totals.studentCount}`,
    );
  }
  if (result.totals.enrollmentCount !== expectedStudents) {
    throw new Error(
      `Expected ${expectedStudents} enrollments, got ${result.totals.enrollmentCount}`,
    );
  }

  const boardCodes = new Set(result.boards.map((b) => b.code));
  if (boardCodes.size !== result.boards.length) {
    throw new Error('Duplicate board codes in seed');
  }

  const schoolCodes = new Set(result.schools.map((s) => s.institution.code));
  if (schoolCodes.size !== result.schools.length) {
    throw new Error('Duplicate school codes in seed');
  }

  for (const school of result.schools) {
    if (school.institution.boardId !== school.board.id) {
      throw new Error(
        `School ${school.institution.code} boardId mismatch with board ${school.board.code}`,
      );
    }
    if (school.institution.tenantId !== result.tenant.id) {
      throw new Error(`School ${school.institution.code} tenant mismatch`);
    }
    for (const enrollment of school.enrollments) {
      if (enrollment.institutionId !== school.institution.id) {
        throw new Error('Enrollment institution mismatch');
      }
      if (enrollment.tenantId !== result.tenant.id) {
        throw new Error('Enrollment tenant mismatch');
      }
    }
  }
}
