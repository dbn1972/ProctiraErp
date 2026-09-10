/**
 * Test data seeding utilities for common test scenarios.
 */

import { createAcademicPeriod } from '../factories/academic-period.factory.js';
import { createAreaHierarchy } from '../factories/area.factory.js';
import { createEnrollment } from '../factories/enrollment.factory.js';
import { createInstitution } from '../factories/institution.factory.js';
import { createStaff } from '../factories/staff.factory.js';
import { createStudentList } from '../factories/student.factory.js';
import { createTenant } from '../factories/tenant.factory.js';
import type {
  Tenant,
  Area,
  Institution,
  Student,
  Staff,
  AcademicPeriod,
  Enrollment,
} from '../factories/types.js';

export interface SeedResult {
  tenant: Tenant;
  areas: Area[];
  institution: Institution;
  academicPeriod: AcademicPeriod;
  students: Student[];
  staff: Staff[];
  enrollments: Enrollment[];
}

export interface SeedOptions {
  /** Number of students to create (default: 10) */
  studentCount?: number;
  /** Number of staff to create (default: 3) */
  staffCount?: number;
  /** Area hierarchy depth (default: 4) */
  areaDepth?: number;
  /** Tenant overrides */
  tenantOverrides?: Partial<Tenant>;
}

/**
 * Seeds a complete test scenario with a tenant, area hierarchy, institution,
 * academic period, students, staff, and enrollments.
 *
 * This is useful for integration tests that need a realistic data setup.
 * All entities are linked together with proper foreign key relationships.
 */
export function seedTestData(options: SeedOptions = {}): SeedResult {
  const { studentCount = 10, staffCount = 3, areaDepth = 4, tenantOverrides = {} } = options;

  // Create tenant
  const tenant = createTenant(tenantOverrides);

  // Create area hierarchy
  const areas = createAreaHierarchy(tenant.id, areaDepth);
  const leafArea = areas[areas.length - 1]!;

  // Create institution in the leaf area
  const institution = createInstitution({
    tenantId: tenant.id,
    areaId: leafArea.id,
  });

  // Create academic period for the institution
  const academicPeriod = createAcademicPeriod({
    tenantId: tenant.id,
    institutionId: institution.id,
    status: 'ACTIVE',
  });

  // Create students
  const students = createStudentList(studentCount, { tenantId: tenant.id });

  // Create staff
  const staff = Array.from({ length: staffCount }, () => createStaff({ tenantId: tenant.id }));

  // Create enrollments linking students to the institution
  const enrollments = students.map((student) =>
    createEnrollment({
      tenantId: tenant.id,
      studentId: student.id,
      institutionId: institution.id,
      academicPeriodId: academicPeriod.id,
      status: 'ENROLLED',
    }),
  );

  return {
    tenant,
    areas,
    institution,
    academicPeriod,
    students,
    staff,
    enrollments,
  };
}
