/**
 * Property-based testing utilities with fast-check integration.
 */

export {
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
} from './arbitraries.js';

export {
  assertProperty,
  withSeed,
  createPropertyRunner,
  getDefaultParameters,
  fc,
} from './helpers.js';
