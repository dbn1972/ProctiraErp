/**
 * Tenant-scoped helper for raw `node-pg` repositories (G-103).
 *
 * Raw-SQL domain tables (db/sql/015_rls_policies.sql) enforce RLS via
 * `current_setting('app.tenant_id', true)`. That setting must be transaction-
 * local (`set_config(..., true)` / SET LOCAL) on the *same* connection that
 * runs the queries — identical rationale to {@link withTenantTransaction}.
 *
 * Also sets `app.current_tenant_id` so Prisma RLS policies stay consistent
 * when the same connection is reused.
 *
 * @example
 * ```ts
 * const rows = await withPgTenant(pool, tenantId, (client) =>
 *   client.query('SELECT * FROM staff_leave_requests'),
 * );
 * ```
 */

/** Minimal queryable surface (pg.Pool, PoolClient, or test double). */
export interface PgQueryable {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: unknown[] } & Record<string, unknown>>;
}

/** Pool that can check out a client (real pg.Pool). */
export interface PgPoolWithConnect extends PgQueryable {
  connect: () => Promise<PgClient>;
}

export interface PgClient extends PgQueryable {
  release: () => void;
}

function assertTenantId(tenantId: string): void {
  // Health stores use TEXT tenant ids that may not be UUID — require non-empty.
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new Error(`withPgTenant: invalid tenantId "${tenantId}"`);
  }
}

async function bindTenant(client: PgQueryable, tenantId: string): Promise<void> {
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
}

/**
 * Runs `fn` with `app.tenant_id` (and `app.current_tenant_id`) bound for RLS.
 *
 * When `pool.connect` exists, uses BEGIN/COMMIT so set_config(..., true) is
 * transaction-local on a dedicated client. When only `query` is available
 * (test doubles), binds on that object and runs `fn` directly.
 */
export async function withPgTenant<T>(
  pool: PgPoolWithConnect | PgQueryable,
  tenantId: string,
  fn: (client: PgQueryable) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);

  const connectable = pool as PgPoolWithConnect;
  if (typeof connectable.connect === 'function') {
    const client = await connectable.connect();
    try {
      await client.query('BEGIN');
      await bindTenant(client, tenantId);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw err;
    } finally {
      client.release();
    }
  }

  await bindTenant(pool, tenantId);
  return fn(pool);
}
