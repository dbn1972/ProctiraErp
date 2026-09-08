/**
 * Tenant-scoped transaction helper.
 *
 * Why this exists:
 * Tenant isolation is enforced by PostgreSQL Row-Level Security policies that
 * compare each row's `tenant_id` against `current_setting('app.current_tenant_id')`.
 * That session variable is set with `set_config(..., true)` — the `true` makes it
 * *transaction-local*. Because the PrismaClient is a process-wide singleton backed
 * by a connection pool, the `set_config` call and the queries it must govern have
 * to run on the *same* pooled connection inside the *same* transaction. Setting it
 * outside a transaction (or in a separate statement) leaves it bound to whichever
 * connection happened to serve that statement, so subsequent queries — checked out
 * on a different connection — see an unset tenant and RLS returns zero rows.
 *
 * `withTenantTransaction` is the single sanctioned way to run tenant-scoped DB work:
 * it opens an interactive transaction, binds the tenant on that connection, and runs
 * the caller's logic against the transaction client.
 *
 * @example
 * ```ts
 * const student = await withTenantTransaction(prisma, tenantId, (tx) =>
 *   tx.student.findFirst({ where: { id } }),
 * );
 * ```
 */
import type { Prisma, PrismaClient } from '@prisma/client';

/** The Prisma client bound to an open interactive transaction. */
export type TenantTransactionClient = Prisma.TransactionClient;

/** Options forwarded to the underlying Prisma interactive transaction. */
export interface TenantTransactionOptions {
  /** Max time (ms) Prisma waits for a connection before failing. */
  maxWait?: number;
  /** Max time (ms) the transaction may run before being rolled back. */
  timeout?: number;
  /** Transaction isolation level. */
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

// Matches the canonical UUID v4 used for tenant IDs across the platform.
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside a transaction whose connection has `app.current_tenant_id`
 * bound to `tenantId`, so every query inside is governed by the RLS policies.
 *
 * The tenant id is passed as a bound parameter (not string-interpolated) and is
 * validated as a UUID v4 up front, so it can never be used to inject SQL.
 *
 * @throws {Error} if `tenantId` is not a valid UUID v4.
 */
export async function withTenantTransaction<T>(
  prisma: PrismaClient,
  tenantId: string,
  fn: (tx: TenantTransactionClient) => Promise<T>,
  options?: TenantTransactionOptions,
): Promise<T> {
  if (!UUID_V4.test(tenantId)) {
    throw new Error(
      `withTenantTransaction: invalid tenantId "${tenantId}" (expected UUID v4)`,
    );
  }

  return prisma.$transaction(async (tx) => {
    // Bind the tenant for RLS on THIS connection, scoped to THIS transaction.
    // `${tenantId}` is bound as $1, so the statement is parameterized and safe.
    // Set both names: Prisma policies use app.current_tenant_id; raw-SQL
    // policies in db/sql/015_rls_policies.sql use app.tenant_id (G-103).
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }, options);
}
