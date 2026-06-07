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

export interface BatchInsertOptions {
  /** Number of records per batch (default: 100) */
  batchSize?: number;
  /** Whether to skip duplicate records (default: false) */
  skipDuplicates?: boolean;
}

/**
 * Insert records in batches using Prisma's createMany.
 *
 * Uses Prisma's built-in createMany which generates efficient
 * multi-row INSERT statements under the hood, avoiding the overhead
 * of individual create calls.
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
  options: BatchInsertOptions | number = {}
): Promise<number> {
  if (records.length === 0) return 0;

  const opts: BatchInsertOptions =
    typeof options === 'number' ? { batchSize: options } : options;
  const batchSize = opts.batchSize ?? 100;
  const skipDuplicates = opts.skipDuplicates ?? false;

  let totalInserted = 0;

  // Process records in batches
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    // Use Prisma's $transaction with raw SQL for maximum performance
    const result = await (prisma as unknown as Record<string, { createMany: (args: unknown) => Promise<{ count: number }> }>)[model]!.createMany({
      data: batch,
      skipDuplicates,
    });

    totalInserted += result.count;
  }

  return totalInserted;
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
 * @returns Total number of records inserted
 */
export async function batchInsertRaw(
  prisma: PrismaClient,
  table: string,
  columns: string[],
  records: unknown[][],
  batchSize = 100
): Promise<number> {
  if (records.length === 0) return 0;

  // Validate table and column names to prevent SQL injection
  const safeTable = sanitizeIdentifier(table);
  const safeColumns = columns.map(sanitizeIdentifier);

  let totalInserted = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    // Build parameterized INSERT statement
    const columnList = safeColumns.join(', ');
    const placeholders = batch
      .map(
        (_, rowIdx) =>
          `(${safeColumns.map((_, colIdx) => `$${rowIdx * safeColumns.length + colIdx + 1}`).join(', ')})`
      )
      .join(', ');

    const values = batch.flat();

    const query = Prisma.raw(
      `INSERT INTO "${safeTable}" (${columnList}) VALUES ${placeholders}`
    );

    // Assign values to the raw query
    (query as unknown as { values: unknown[] }).values = values;

    const result = await prisma.$executeRaw(query);
    totalInserted += result;
  }

  return totalInserted;
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
