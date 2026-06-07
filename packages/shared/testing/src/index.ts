/**
 * @proctira/testing - Test utilities, factories, fixtures, and property-testing helpers
 * for the ProctiraERP Unified Platform.
 */

// Factories
export {
  createTenant,
  createTenantConfig,
  createInstitution,
  createInstitutionList,
  createStudent,
  createStudentList,
  createStaff,
  createStaffList,
  createEnrollment,
  createArea,
  createAreaHierarchy,
  createAcademicPeriod,
} from './factories/index.js';

export type {
  Tenant,
  TenantConfig,
  Area,
  Institution,
  Student,
  Staff,
  Enrollment,
  AcademicPeriod,
} from './factories/index.js';

// Database utilities
export {
  TestDatabase,
  withTestTransaction,
  createTransactionScope,
  seedTestData,
} from './database/index.js';

export type {
  DatabaseClient,
  TestDatabaseOptions,
  SeedResult,
  SeedOptions,
} from './database/index.js';

// Fixtures
export {
  createTenantFixture,
  createMultiTenantFixture,
} from './fixtures/index.js';

export type {
  TenantFixture,
  TenantFixtureOptions,
  MultiTenantFixture,
  MultiTenantFixtureOptions,
} from './fixtures/index.js';

// Property-based testing
export {
  assertProperty,
  withSeed,
  createPropertyRunner,
  getDefaultParameters,
  fc,
  uuidArb,
  emailArb,
  nameArb,
  dateArb,
  dateObjectArb,
  paginationArb,
  paginationWithSortArb,
  phoneArb,
  tenantSlugArb,
  areaLevelArb,
  enrollmentStatusArb,
  entityStatusArb,
  attendanceStatusArb,
  capacityArb,
  percentageArb,
} from './property-testing/index.js';
