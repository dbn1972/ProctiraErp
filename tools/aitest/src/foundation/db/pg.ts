import pg from 'pg';

export type PgClient = pg.Client;

export async function withPg<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: url, application_name: 'proctira-aitest' });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Runs fn in a transaction with app.tenant_id bound transaction-locally, the
 * way the runtime binds tenant scope for FORCE RLS.
 */
export async function asTenant<T>(
  c: pg.Client,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await c.query('BEGIN');
  try {
    await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const out = await fn();
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  }
}

/** Base tables in schema public that have a tenant_id column. */
export async function listTenantTables(c: pg.Client): Promise<string[]> {
  const r = await c.query<{ table_name: string }>(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name`,
  );
  return r.rows.map((x) => x.table_name);
}

/** Tenant tables that also have an `id` column (route-param candidates). */
export async function listTenantTablesWithId(c: pg.Client): Promise<string[]> {
  const r = await c.query<{ table_name: string }>(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
        AND EXISTS (SELECT 1 FROM information_schema.columns i
                     WHERE i.table_schema = 'public' AND i.table_name = c.table_name AND i.column_name = 'id')
      ORDER BY c.table_name`,
  );
  return r.rows.map((x) => x.table_name);
}

/** Double-quoted SQL identifier. */
export function ident(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
