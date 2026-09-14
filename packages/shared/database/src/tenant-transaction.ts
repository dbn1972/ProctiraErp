/**
 * Tenant-scoped transaction helper (W1-DATA-12).
 *
 * Why this exists:
 * Tenant isolation is enforced by PostgreSQL Row-Level Security policies that
 * compare each row's `tenant_id` against the effective tenant
 * (`app_tenant_id()` → canonical `app.tenant_id`, with legacy
 * `app.current_tenant_id` alias). That session variable is set with
 * `set_config(..., true)` — the `true` makes it *transaction-local*. Because
 * the PrismaClient is a process-wide singleton backed by a connection pool,
 * the `set_config` call and the queries it must govern have to run on the
 * *same* pooled connection inside the *same* transaction.
 *
 * `withTenantTransaction` is the single sanctioned way to run tenant-scoped DB
 * work via Prisma: it opens an interactive transaction, binds the tenant via
 * {@link bindTenantGucPrisma}, and runs the caller's logic against the
 * transaction client.
 *
 * @example
 * ```ts
 * const student = await withTenantTransaction(prisma, tenantId, (tx) =>
 *   tx.student.findFirst({ where: { id } }),
 * );
 * ```
 */
import type { Prisma, PrismaClient } from '@prisma/client';

import { bindTenantGucPrisma } from './tenant-guc.js';

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
 * Runs `fn` inside a transaction whose connection has the canonical tenant GUC
 * bound to `tenantId` (legacy alias synced), so every query inside is governed
 * by RLS.
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
    throw new Error(`withTenantTransaction: invalid tenantId "${tenantId}" (expected UUID v4)`);
  }

  return prisma.$transaction(async (tx) => {
    await bindTenantGucPrisma(tx, tenantId);
    return fn(tx);
  }, options);
}
