/**
 * Data factories for generating test entities.
 * Each factory returns typed objects matching Prisma model shapes with sensible defaults.
 */

export { createTenant, createTenantConfig } from './tenant.factory.js';
export { createInstitution, createInstitutionList } from './institution.factory.js';
export { createStudent, createStudentList } from './student.factory.js';
export { createStaff, createStaffList } from './staff.factory.js';
export { createEnrollment } from './enrollment.factory.js';
export { createArea, createAreaHierarchy } from './area.factory.js';
export { createAcademicPeriod } from './academic-period.factory.js';

export type {
  Tenant,
  TenantConfig,
  Area,
  Institution,
  Student,
  Staff,
  Enrollment,
  AcademicPeriod,
} from './types.js';
