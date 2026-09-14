/**
 * @proctira/database - Prisma schema, client, migrations, and tenant utilities
 *
 * This package provides:
 * - PrismaClient singleton factory
 * - Re-exported Prisma types and enums
 * - Database connection utilities
 */

// Re-export PrismaClient and all generated types
export { PrismaClient, Prisma } from '@prisma/client';
export type {
  Tenant,
  GeographicArea,
  Board,
  Institution,
  Student,
  Staff,
  Enrollment,
  AcademicPeriod,
  Grade,
  Class,
  Subject,
  InstitutionSubject,
  RefreshToken,
  UserSession,
} from '@prisma/client';

// Re-export enums
export { BoardType, EnrollmentStatus } from '@prisma/client';

// Export client utilities
export { createPrismaClient, getPrismaClient, disconnectPrisma } from './client';

// Export batch insert utilities
export { batchInsert, batchInsertRaw } from './batch-insert';
export type { BatchInsertOptions } from './batch-insert';

// Export read replica utilities
export {
  createReadReplicaClient,
  getReadReplicaClient,
  disconnectReadReplica,
} from './read-replica';

// Export tenant-scoped transaction helper (required for RLS-governed queries)
export { withTenantTransaction } from './tenant-transaction';
export type { TenantTransactionClient, TenantTransactionOptions } from './tenant-transaction';

// Export node-pg tenant binder for raw-SQL RLS (db/sql/015_rls_policies.sql)
export { withPgTenant } from './pg-tenant';
export type { PgQueryable, PgPoolWithConnect, PgClient } from './pg-tenant';

// W1-DATA-12: canonical tenant GUC binder (app.tenant_id + legacy alias sync)
export {
  APP_TENANT_ID_GUC,
  APP_TENANT_ID_LEGACY_GUC,
  BIND_TENANT_GUC_SQL,
  SET_APP_TENANT_ID_SQL,
  bindTenantGuc,
  bindTenantGucPrisma,
} from './tenant-guc';
export type { TenantGucQueryable, TenantGucPrismaLike } from './tenant-guc';

// G-704: shared node-pg pool + JSONB document collection for control-plane stores
export {
  PG_POOL_DEFAULTS,
  buildPgPoolOptions,
  closeSharedPgPools,
  getSharedPgPool,
  resolveDatabaseUrl,
  resolvePgPoolConfig,
} from './pg-pool';
export type { PgPoolEnv, PgPoolSizing } from './pg-pool';
export type { PgPool } from './pg-pool';
export { PgDocumentCollection, withPlatformScope, reviveDates } from './pg-document-store';
export type { DocumentRow } from './pg-document-store';

// G-714 / P0-05: in-memory fallback policy shared by repository factories
export {
  assertInMemoryFallbackAllowed,
  assertPostgresRepositoryAvailable,
  readPersistencePolicyEnv,
  resolvePersistenceMode,
  resetPersistenceWarnings,
} from './persistence-policy';
export type { PersistenceMode, PersistencePolicyEnv } from './persistence-policy';

// W3-C2: shared readiness probe (Postgres when configured; fail-closed)
export { runReadinessProbe } from './readiness-probe';
export type {
  DatabaseDependencyStatus,
  ReadinessProbeOptions,
  ReadinessProbeResult,
} from './readiness-probe';
