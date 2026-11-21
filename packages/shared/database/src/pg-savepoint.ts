/**
 * D1-F1 / D1-F3: run one tolerated block of a `withPgTenant` transaction under a savepoint.
 *
 * Postgres aborts the whole transaction after any failed statement; every statement after it
 * fails with 25P02 until a rollback. Code that catches an error and carries on inside the same
 * transaction must therefore roll back to a savepoint first. This helper issues
 * `SAVEPOINT <name>`, runs `fn`, then `RELEASE SAVEPOINT <name>` on success, or
 * `ROLLBACK TO SAVEPOINT <name>` + `RELEASE SAVEPOINT <name>` on failure and rethrows the
 * original error. Use it only on a client inside a transaction block.
 */
import type { PgQueryable } from './pg-tenant';

const SAVEPOINT_NAME = /^[a-z_][a-z0-9_]{0,62}$/i;

export async function withPgSavepoint<T>(
  client: PgQueryable,
  name: string,
  fn: (client: PgQueryable) => Promise<T>,
): Promise<T> {
  if (!SAVEPOINT_NAME.test(name)) {
    throw new Error(`withPgSavepoint: invalid savepoint name "${name}"`);
  }
  await client.query(`SAVEPOINT ${name}`);
  let result: T;
  try {
    result = await fn(client);
  } catch (error) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
      await client.query(`RELEASE SAVEPOINT ${name}`);
    } catch {
      // Keep the original error; withPgTenant rolls the whole transaction back.
    }
    throw error;
  }
  await client.query(`RELEASE SAVEPOINT ${name}`);
  return result;
}
