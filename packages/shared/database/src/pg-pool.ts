/**
 * Shared node-pg pool (G-704).
 *
 * Control-plane packages (audit, billing, tenant, auth) previously had no
 * Postgres path at all. They now share one pool per connection string so the
 * gateway does not open a dozen pools against the same database.
 */
import pg from 'pg';

const { Pool } = pg;

const pools = new Map<string, pg.Pool>();

export function resolveDatabaseUrl(explicit?: string): string | null {
  const url = (explicit ?? process.env['DATABASE_URL'])?.trim();
  return url && url.length > 0 ? url : null;
}

/** Returns the shared pool for `DATABASE_URL` (or the given url), or null when unset. */
export function getSharedPgPool(databaseUrl?: string): pg.Pool | null {
  const url = resolveDatabaseUrl(databaseUrl);
  if (!url) return null;
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 10 });
    pools.set(url, pool);
  }
  return pool;
}

/** Test/shutdown helper: close every shared pool. */
export async function closeSharedPgPools(): Promise<void> {
  const open = Array.from(pools.values());
  pools.clear();
  await Promise.all(open.map((p) => p.end().catch(() => undefined)));
}

export type { Pool as PgPool } from 'pg';
