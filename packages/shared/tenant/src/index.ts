/**
 * @proctira/tenant - Tenant resolution, context, and provisioning
 *
 * This package provides:
 * - Tenant resolution from JWT claims, headers, and subdomains
 * - Fastify plugin for automatic tenant context per request
 * - PostgreSQL RLS session variable management
 * - Tenant provisioning utilities
 */

// Tenant Resolution
export {
  resolveTenantId,
  isValidUuid,
  TenantResolutionError,
} from './tenant-resolution.js';
export type {
  TenantResolutionResult,
  TenantResolutionOptions,
} from './tenant-resolution.js';

// Fastify Plugin
export { tenantPlugin } from './fastify-plugin.js';
export type { TenantPluginOptions } from './fastify-plugin.js';

// Provisioning
export { seedIndiaDemoSchool, INDIA_DEMO_SCHOOL_CODE, INDIA_DEMO_SCHOOL_NAME } from './india-school.js';
export type {
  IndiaSchoolStore,
  SeedIndiaSchoolInput,
  SeedIndiaSchoolResult,
} from './india-school.js';

export {
  seedIndiaDemoEnrollment,
  INDIA_DEMO_STUDENT_NATIONAL_ID,
  INDIA_DEMO_STUDENT_FIRST_NAME,
  INDIA_DEMO_STUDENT_LAST_NAME,
} from './india-enrollment.js';
export type {
  IndiaEnrollmentStore,
  SeedIndiaEnrollmentInput,
  SeedIndiaEnrollmentResult,
} from './india-enrollment.js';

export { seedAcademicStructure } from './academic-structure.js';
export type {
  AcademicStructureStore,
  SeedAcademicStructureInput,
  SeedAcademicStructureResult,
} from './academic-structure.js';

export { provisionTenant } from './provisioning.js';
export type {
  ProvisionTenantInput,
  ProvisionTenantResult,
  ProvisioningDbClient,
  ProvisioningTxClient,
} from './provisioning.js';
