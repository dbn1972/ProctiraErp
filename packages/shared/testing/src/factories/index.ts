/**
 * Data factories for generating test entities.
 * Each factory returns typed objects matching Prisma model shapes with sensible defaults.
 */
import { faker } from '@faker-js/faker';

/**
 * PRC-L498 — seed the shared faker instance so factory output (including random
 * enum status and date-relative values) is deterministic. Reads FC_SEED when no
 * explicit seed is given, matching the property-testing harness. Call this once
 * in a test setup (e.g. beforeAll) for reproducible factory data.
 */
export function seedFactories(seed?: number): number {
  const resolved =
    seed ?? (process.env['FC_SEED'] ? Number.parseInt(process.env['FC_SEED'], 10) : 20260101);
  const effective = Number.isFinite(resolved) ? resolved : 20260101;
  faker.seed(effective);
  return effective;
}

export { createTenant, createTenantConfig } from './tenant.factory.js';
export { createBoard, createBoardList } from './board.factory.js';
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
  Board,
  BoardType,
  Institution,
  Student,
  Staff,
  Enrollment,
  AcademicPeriod,
} from './types.js';
