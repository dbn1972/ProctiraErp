/**
 * Shared node-pg pool (G-704, W3-D3).
 *
 * Control-plane packages (audit, billing, tenant, auth) previously had no
 * Postgres path at all. They now share one pool per connection string so the
 * gateway does not open a dozen pools against the same database.
 *
 * W3-D3 hygiene: every shared pool is bounded — explicit max connections,
 * idle release, and acquisition timeout. node-pg defaults leave
 * `connectionTimeoutMillis` at 0 (wait forever) and allow each package to
 * construct its own pool; both patterns exhaust Postgres under load.
 *
 * Override via env (all optional):
 *   PG_POOL_MAX / DATABASE_POOL_SIZE — max clients per process (default 10, cap 100)
 *   PG_POOL_IDLE_TIMEOUT_MS — close idle clients after N ms (default 30000)
 *   PG_POOL_CONNECTION_TIMEOUT_MS — fail acquisition after N ms (default 10000)
 *   PG_STATEMENT_TIMEOUT_MS — server-side per-statement cap (default 30000)
 *   PG_QUERY_TIMEOUT_MS — client-side per-query cap (default 30000)
 *   PG_IDLE_IN_TX_TIMEOUT_MS — abort sessions idle-in-transaction (default 60000)
 */
import pg from 'pg';

const { Pool } = pg;

/** Bounded defaults aligned with Prisma `connection_limit=10` / install wizard poolSize. */
export const PG_POOL_DEFAULTS = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  /**
   * W1-DATA — a shared pool with no statement/query timeout lets a single slow
   * or hung upstream query pin a connection forever, starving the pool. These
   * bound every statement at both the Postgres server (`statement_timeout`,
   * `idle_in_transaction_session_timeout`) and the node-pg client (`query_timeout`).
   */
  statementTimeoutMillis: 30_000,
  queryTimeoutMillis: 30_000,
  idleInTransactionSessionTimeoutMillis: 60_000,
} as const;

export type PgPoolSizing = {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statementTimeoutMillis: number;
  queryTimeoutMillis: number;
  idleInTransactionSessionTimeoutMillis: number;
};

export type PgPoolEnv = Record<string, string | undefined>;

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

/**
 * Resolves bounded node-pg pool sizing from environment.
 * Exported for unit tests and observability hooks.
 */
export function resolvePgPoolConfig(env: PgPoolEnv = process.env): PgPoolSizing {
  const maxRaw = env['PG_POOL_MAX'] ?? env['DATABASE_POOL_SIZE'];
  return {
    max: parseBoundedInt(maxRaw, PG_POOL_DEFAULTS.max, 1, 100),
    idleTimeoutMillis: parseBoundedInt(
      env['PG_POOL_IDLE_TIMEOUT_MS'],
      PG_POOL_DEFAULTS.idleTimeoutMillis,
      1_000,
      600_000,
    ),
    connectionTimeoutMillis: parseBoundedInt(
      env['PG_POOL_CONNECTION_TIMEOUT_MS'],
      PG_POOL_DEFAULTS.connectionTimeoutMillis,
      1_000,
      120_000,
    ),
    statementTimeoutMillis: parseBoundedInt(
      env['PG_STATEMENT_TIMEOUT_MS'],
      PG_POOL_DEFAULTS.statementTimeoutMillis,
      1_000,
      600_000,
    ),
    queryTimeoutMillis: parseBoundedInt(
      env['PG_QUERY_TIMEOUT_MS'],
      PG_POOL_DEFAULTS.queryTimeoutMillis,
      1_000,
      600_000,
    ),
    idleInTransactionSessionTimeoutMillis: parseBoundedInt(
      env['PG_IDLE_IN_TX_TIMEOUT_MS'],
      PG_POOL_DEFAULTS.idleInTransactionSessionTimeoutMillis,
      1_000,
      600_000,
    ),
  };
}

/** Builds node-pg Pool constructor options with W3-D3 bounds applied. */
export function buildPgPoolOptions(
  connectionString: string,
  env: PgPoolEnv = process.env,
): pg.PoolConfig {
  const sizing = resolvePgPoolConfig(env);
  return {
    connectionString,
    max: sizing.max,
    idleTimeoutMillis: sizing.idleTimeoutMillis,
    connectionTimeoutMillis: sizing.connectionTimeoutMillis,
    // Client-side cap: node-pg rejects the query and destroys the socket.
    query_timeout: sizing.queryTimeoutMillis,
    statement_timeout: sizing.statementTimeoutMillis,
    // Server-side cap: Postgres aborts statements / idle-in-tx sessions even if
    // the client never notices (e.g. a dropped connection mid-query).
    idle_in_transaction_session_timeout: sizing.idleInTransactionSessionTimeoutMillis,
  };
}

const pools = new Map<string, pg.Pool>();

export function resolveDatabaseUrl(explicit?: string): string | null {
  const url = (explicit ?? process.env['DATABASE_URL'])?.trim();
  return url && url.length > 0 ? url : null;
}

/**
 * Attaches an `error` listener to a pool. node-pg emits `error` on idle clients
 * (e.g. the backend terminates the connection); without a listener the event is
 * an unhandled `EventEmitter` error and crashes the process. We log and let the
 * pool evict the dead client — the next acquisition opens a fresh connection.
 */
function attachPoolErrorHandler(pool: pg.Pool): void {
  pool.on('error', (err) => {
    // eslint-disable-next-line no-console -- shared package has no logger dependency; stderr is the floor.
    console.error('[pg-pool] idle client error (connection evicted):', err.message);
  });
}

/** Returns the shared pool for `DATABASE_URL` (or the given url), or null when unset. */
export function getSharedPgPool(databaseUrl?: string): pg.Pool | null {
  const url = resolveDatabaseUrl(databaseUrl);
  if (!url) return null;
  let pool = pools.get(url);
  if (!pool) {
    pool = new Pool(buildPgPoolOptions(url));
    attachPoolErrorHandler(pool);
    pools.set(url, pool);
  }
  return pool;
}

/**
 * Test/shutdown helper: close every shared pool.
 * Prefer `closeDatabaseResources()` from process entrypoints (W1-ARCH-07).
 */
export async function closeSharedPgPools(): Promise<void> {
  const open = Array.from(pools.values());
  pools.clear();
  await Promise.all(open.map((p) => p.end().catch(() => undefined)));
}

export type { Pool as PgPool } from 'pg';
