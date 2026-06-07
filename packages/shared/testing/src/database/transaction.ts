/**
 * Transaction-based test isolation utilities.
 * Wraps each test in a transaction that is rolled back after completion.
 */

import type { DatabaseClient } from './test-db.js';

/**
 * Error thrown to trigger transaction rollback.
 * This is an internal mechanism — not a real error.
 */
class RollbackError extends Error {
  constructor() {
    super('__TEST_ROLLBACK__');
    this.name = 'RollbackError';
  }
}

/**
 * Runs a test function within a database transaction that is automatically
 * rolled back after the function completes. This ensures test isolation
 * without leaving any data in the database.
 *
 * @example
 * ```ts
 * it('creates a student', async () => {
 *   await withTestTransaction(prisma, async (tx) => {
 *     const student = await tx.student.create({ data: { ... } });
 *     expect(student.id).toBeDefined();
 *   });
 *   // Transaction is rolled back — no data persisted
 * });
 * ```
 */
export async function withTestTransaction<TClient extends DatabaseClient>(
  client: TClient,
  fn: (tx: TClient) => Promise<void>,
): Promise<void> {
  try {
    await client.$transaction(async (tx) => {
      await fn(tx as TClient);
      // Force rollback by throwing a known error
      throw new RollbackError();
    });
  } catch (error) {
    // Swallow the rollback error — it's expected
    if (error instanceof RollbackError) {
      return;
    }
    // Re-throw any real errors from the test
    throw error;
  }
}

/**
 * Creates a Vitest-compatible setup that wraps each test in a transaction.
 * Returns beforeEach/afterEach hooks and a getter for the transaction client.
 *
 * @example
 * ```ts
 * const { getClient, beforeEachHook, afterEachHook } = createTransactionScope(prisma);
 *
 * beforeEach(beforeEachHook);
 * afterEach(afterEachHook);
 *
 * it('test', async () => {
 *   const tx = getClient();
 *   // use tx for database operations
 * });
 * ```
 */
export function createTransactionScope<TClient extends DatabaseClient>(client: TClient) {
  let currentTx: TClient | null = null;
  let resolveTransaction: (() => void) | null = null;
  let _rejectTransaction: ((err: Error) => void) | null = null;
  let transactionPromise: Promise<void> | null = null;

  const beforeEachHook = async () => {
    transactionPromise = new Promise<void>((resolve, reject) => {
      resolveTransaction = resolve;
      _rejectTransaction = reject;
    });

    // Start a transaction that will be held open until afterEach
    const txPromise = client.$transaction(async (tx) => {
      currentTx = tx as TClient;
      // Wait for the test to complete
      await transactionPromise;
      // Force rollback
      throw new RollbackError();
    });

    // Suppress the expected rollback error
    txPromise.catch((err) => {
      if (!(err instanceof RollbackError)) {
        throw err;
      }
    });

    // Give the transaction time to start
    await new Promise((resolve) => setTimeout(resolve, 10));
  };

  const afterEachHook = async () => {
    // Signal the transaction to complete (and rollback)
    if (resolveTransaction) {
      resolveTransaction();
      resolveTransaction = null;
    }
    currentTx = null;
  };

  const getClient = (): TClient => {
    if (!currentTx) {
      throw new Error('No active transaction. Ensure beforeEach hook has run.');
    }
    return currentTx;
  };

  return { getClient, beforeEachHook, afterEachHook };
}
