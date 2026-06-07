/**
 * Tenant fixture utilities for setting up complete tenant test environments.
 */

import { faker } from '@faker-js/faker';

import { createAcademicPeriod } from '../factories/academic-period.factory.js';
import { createAreaHierarchy } from '../factories/area.factory.js';
import { createInstitutionList } from '../factories/institution.factory.js';
import { createStaffList } from '../factories/staff.factory.js';
import { createStudentList } from '../factories/student.factory.js';
import { createTenant } from '../factories/tenant.factory.js';
import type {
  Tenant,
  Area,
  Institution,
  Student,
  Staff,
  AcademicPeriod,
} from '../factories/types.js';

export interface TenantFixture {
  tenant: Tenant;
  areas: Area[];
  institutions: Institution[];
  students: Student[];
  staff: Staff[];
  academicPeriods: AcademicPeriod[];
  /** Admin user credentials for this tenant */
  adminUser: {
    id: string;
    email: string;
    password: string;
    roles: string[];
  };
}

export interface TenantFixtureOptions {
  /** Number of institutions (default: 2) */
  institutionCount?: number;
  /** Number of students per institution (default: 20) */
  studentsPerInstitution?: number;
  /** Number of staff per institution (default: 5) */
  staffPerInstitution?: number;
  /** Area hierarchy depth (default: 4) */
  areaDepth?: number;
  /** Tenant name override */
  tenantName?: string;
}

/**
 * Creates a complete tenant fixture with area hierarchy, institutions, users, and data.
 * Useful for integration tests that need a fully populated tenant environment.
 */
export function createTenantFixture(options: TenantFixtureOptions = {}): TenantFixture {
  const {
    institutionCount = 2,
    studentsPerInstitution = 20,
    staffPerInstitution = 5,
    areaDepth = 4,
    tenantName,
  } = options;

  // Create tenant
  const tenant = createTenant(tenantName ? { name: tenantName } : {});

  // Create area hierarchy
  const areas = createAreaHierarchy(tenant.id, areaDepth);
  const leafArea = areas[areas.length - 1]!;

  // Create institutions in the leaf area
  const institutions = createInstitutionList(institutionCount, {
    tenantId: tenant.id,
    areaId: leafArea.id,
  });

  // Create academic periods for each institution
  const academicPeriods = institutions.map((inst) =>
    createAcademicPeriod({
      tenantId: tenant.id,
      institutionId: inst.id,
      status: 'ACTIVE',
    }),
  );

  // Create students and staff for each institution
  const students: Student[] = [];
  const staff: Staff[] = [];

  for (const _institution of institutions) {
    students.push(
      ...createStudentList(studentsPerInstitution, {
        tenantId: tenant.id,
      }),
    );
    staff.push(
      ...createStaffList(staffPerInstitution, {
        tenantId: tenant.id,
      }),
    );
  }

  // Create admin user
  const adminUser = {
    id: faker.string.uuid(),
    email: `admin@${tenant.slug}.proctira.org`,
    password: 'TestAdmin123!',
    roles: ['SYSTEM_ADMIN'],
  };

  return {
    tenant,
    areas,
    institutions,
    students,
    staff,
    academicPeriods,
    adminUser,
  };
}
