/**
 * Batch Insert Helper
 *
 * Inserts large numbers of records efficiently by batching them into
 * groups and using raw SQL INSERT statements instead of individual
 * Prisma creates. This avoids N+1 insert overhead and reduces
 * round-trips to the database.
 *
 * @example
 * ```ts
 * const count = await batchInsert(prisma, 'Student', students, 100);
 * ```
 */
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { withTenantTransaction, type TenantTransactionClient } from './tenant-transaction.js';

export interface BatchInsertOptions {
  /** Number of records per batch (default: 100) */
  batchSize?: number;
  /** Whether to skip duplicate records (default: false) */
  skipDuplicates?: boolean;
  /**
   * Tenant to bind (`app.tenant_id` GUC) for the transaction so RLS governs the
   * inserts. Required for tenant-owned tables under FORCE RLS (PRC-L491).
   */
  tenantId?: string;
}

/** Options for {@link batchInsertRaw}. */
export interface BatchInsertRawOptions {
  /** Tenant to bind for the transaction (see {@link BatchInsertOptions.tenantId}). */
  tenantId?: string;
}

/**
 * Runs all batches in ONE interactive transaction so a failure in any batch rolls
 * back the earlier ones (PRC-L491). Binds the tenant GUC when `tenantId` is given.
 */
function inSingleTransaction<T>(
  prisma: PrismaClient,
  tenantId: string | undefined,
  fn: (tx: TenantTransactionClient) => Promise<T>,
): Promise<T> {
  if (tenantId !== undefined) {
    return withTenantTransaction(prisma, tenantId, fn);
  }
  return prisma.$transaction(fn);
}

/**
 * Insert records in batches using Prisma's createMany.
 *
 * Uses Prisma's built-in createMany which generates efficient
 * multi-row INSERT statements under the hood, avoiding the overhead
 * of individual create calls. All batches share one transaction (atomic).
 *
 * @param prisma - PrismaClient instance
 * @param model - Prisma model name (e.g., 'student', 'enrollment')
 * @param records - Array of records to insert
 * @param options - Batch configuration options
 * @returns Total number of records inserted
 */
export async function batchInsert<T extends Record<string, unknown>>(
  prisma: PrismaClient,
  model: string,
  records: T[],
  options: BatchInsertOptions | number = {},
): Promise<number> {
  if (records.length === 0) return 0;

  const opts: BatchInsertOptions = typeof options === 'number' ? { batchSize: options } : options;
  const batchSize = opts.batchSize ?? 100;
  const skipDuplicates = opts.skipDuplicates ?? false;

  return inSingleTransaction(prisma, opts.tenantId, async (tx) => {
    const delegate = (
      tx as unknown as Record<string, { createMany: (args: unknown) => Promise<{ count: number }> }>
    )[model];
    if (!delegate || typeof delegate.createMany !== 'function') {
      throw new Error(`batchInsert: unknown Prisma model "${model}"`);
    }
    let totalInserted = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const result = await delegate.createMany({ data: batch, skipDuplicates });
      totalInserted += result.count;
    }
    return totalInserted;
  });
}

/**
 * Insert records in batches using raw SQL for maximum performance.
 * Use this when you need to bypass Prisma's model layer for bulk operations.
 *
 * @param prisma - PrismaClient instance
 * @param table - Database table name (snake_case)
 * @param columns - Column names to insert
 * @param records - Array of value arrays matching column order
 * @param batchSize - Records per batch (default: 100)
 * @param options - Optional tenant binding; all batches run in one transaction
 * @returns Total number of records inserted
 */
export async function batchInsertRaw(
  prisma: PrismaClient,
  table: string,
  columns: string[],
  records: unknown[][],
  batchSize = 100,
  options: BatchInsertRawOptions = {},
): Promise<number> {
  if (records.length === 0) return 0;

  // Validate table and column names to prevent SQL injection
  const safeTable = sanitizeIdentifier(table);
  const safeColumns = columns.map(sanitizeIdentifier);

  for (const row of records) {
    if (row.length !== safeColumns.length) {
      throw new Error(
        `batchInsertRaw: row has ${row.length} values, expected ${safeColumns.length}`,
      );
    }
  }

  const head = Prisma.raw(`INSERT INTO "${safeTable}" (${safeColumns.join(', ')}) VALUES `);

  return inSingleTransaction(prisma, options.tenantId, async (tx) => {
    let totalInserted = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      // Tagged Prisma.sql keeps every value a bound parameter (no internals patching).
      const rows = Prisma.join(batch.map((row) => Prisma.sql`(${Prisma.join(row)})`));
      totalInserted += await tx.$executeRaw(Prisma.sql`${head}${rows}`);
    }
    return totalInserted;
  });
}

/**
 * Sanitize a SQL identifier (table/column name) to prevent injection.
 * Only allows alphanumeric characters and underscores.
 */
function sanitizeIdentifier(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: "${name}"`);
  }
  return name;
}
