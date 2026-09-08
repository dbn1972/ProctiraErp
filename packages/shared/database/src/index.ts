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
export {
  createPrismaClient,
  getPrismaClient,
  disconnectPrisma,
} from './client';

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
export type {
  TenantTransactionClient,
  TenantTransactionOptions,
} from './tenant-transaction';

// Export node-pg tenant binder for raw-SQL RLS (db/sql/015_rls_policies.sql)
export { withPgTenant } from './pg-tenant';
export type { PgQueryable, PgPoolWithConnect, PgClient } from './pg-tenant';
