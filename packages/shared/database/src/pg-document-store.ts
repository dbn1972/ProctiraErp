/**
 * Generic JSONB document collection on `control_plane_documents`
 * (db/sql/022_control_plane_schema.sql) — G-704.
 *
 * Control-plane aggregates (billing plans/subscriptions, tenant lifecycle,
 * invites, OTP challenges, IdP identities, platform-admin console state) were
 * in-memory only. They now persist as typed JSON documents keyed by
 * `(collection, id)` with an optional `tenant_id` for RLS. Repositories keep
 * their existing filtering logic and simply read/write through this class.
 *
 * Platform-scoped rows (no tenant) are visible only when the connection has
 * `app.platform_admin = '1'` bound — see {@link withPlatformScope}.
 */
import type { PgPoolWithConnect, PgQueryable } from './pg-tenant';

export interface DocumentRow<T> {
  id: string;
  tenantId: string | null;
  data: T;
  createdAt: Date;
  updatedAt: Date;
}

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(String(v));
}

/**
 * Runs `fn` on a dedicated client with `app.platform_admin = '1'` bound
 * (transaction-local), so RLS policies that allow the control plane pass.
 * When `tenantId` is given, `app.tenant_id` is bound as well.
 */
export async function withPlatformScope<T>(
  pool: PgPoolWithConnect | PgQueryable,
  fn: (client: PgQueryable) => Promise<T>,
  tenantId?: string | null,
): Promise<T> {
  const bind = async (client: PgQueryable) => {
    await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
    if (tenantId) {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
    }
  };
  const connectable = pool as PgPoolWithConnect;
  if (typeof connectable.connect === 'function') {
    const client = await connectable.connect();
    try {
      await client.query('BEGIN');
      await bind(client);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    } finally {
      client.release();
    }
  }
  await bind(pool);
  return fn(pool);
}

/** Revive ISO-8601 strings produced by JSON.stringify(Date) back into Dates. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function reviveDates<T>(value: T): T {
  if (typeof value === 'string') {
    return (ISO_DATE.test(value) ? new Date(value) : value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).map((v) => reviveDates(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = reviveDates(v);
    }
    return out as T;
  }
  return value;
}

export class PgDocumentCollection<T extends object> {
  constructor(
    private readonly pool: PgPoolWithConnect | PgQueryable,
    private readonly collection: string,
    private readonly options: {
      /** Extra date fields to revive (defaults to any ISO string). */
      reviveDates?: boolean;
    } = { reviveDates: true },
  ) {}

  private map(row: Record<string, unknown>): DocumentRow<T> {
    const raw = row.data as T;
    return {
      id: String(row.id),
      tenantId: row.tenant_id == null ? null : String(row.tenant_id),
      data: this.options.reviveDates === false ? raw : reviveDates(raw),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  async get(id: string): Promise<T | null> {
    return withPlatformScope(this.pool, async (client) => {
      const res = await client.query(
        `SELECT * FROM control_plane_documents WHERE collection = $1 AND id = $2 LIMIT 1`,
        [this.collection, id],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? this.map(row).data : null;
    });
  }

  async put(id: string, data: T, tenantId: string | null = null): Promise<T> {
    return withPlatformScope(this.pool, async (client) => {
      const res = await client.query(
        `INSERT INTO control_plane_documents (collection, id, tenant_id, data)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (collection, id)
         DO UPDATE SET data = EXCLUDED.data, tenant_id = EXCLUDED.tenant_id, updated_at = now()
         RETURNING *`,
        [this.collection, id, tenantId, JSON.stringify(data)],
      );
      return this.map(res.rows[0] as Record<string, unknown>).data;
    });
  }

  async delete(id: string): Promise<boolean> {
    return withPlatformScope(this.pool, async (client) => {
      const res = await client.query(
        `DELETE FROM control_plane_documents WHERE collection = $1 AND id = $2`,
        [this.collection, id],
      );
      return Number(res.rowCount ?? 0) > 0;
    });
  }

  async all(): Promise<T[]> {
    return withPlatformScope(this.pool, async (client) => {
      const res = await client.query(
        `SELECT * FROM control_plane_documents WHERE collection = $1 ORDER BY created_at ASC`,
        [this.collection],
      );
      return res.rows.map((r) => this.map(r as Record<string, unknown>).data);
    });
  }

  async byTenant(tenantId: string): Promise<T[]> {
    return withPlatformScope(this.pool, async (client) => {
      const res = await client.query(
        `SELECT * FROM control_plane_documents
         WHERE collection = $1 AND tenant_id = $2 ORDER BY created_at ASC`,
        [this.collection, tenantId],
      );
      return res.rows.map((r) => this.map(r as Record<string, unknown>).data);
    });
  }

  /** Find documents where `data @> $criteria` (JSONB containment). */
  async where(criteria: Partial<T>, tenantId?: string): Promise<T[]> {
    return withPlatformScope(this.pool, async (client) => {
      const params: unknown[] = [this.collection, JSON.stringify(criteria)];
      let sql = `SELECT * FROM control_plane_documents WHERE collection = $1 AND data @> $2::jsonb`;
      if (tenantId) {
        params.push(tenantId);
        sql += ` AND tenant_id = $3`;
      }
      sql += ' ORDER BY created_at ASC';
      const res = await client.query(sql, params);
      return res.rows.map((r) => this.map(r as Record<string, unknown>).data);
    });
  }

  async first(criteria: Partial<T>, tenantId?: string): Promise<T | null> {
    const rows = await this.where(criteria, tenantId);
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    return withPlatformScope(this.pool, async (client) => {
      const res = await client.query(
        `SELECT COUNT(*)::int AS c FROM control_plane_documents WHERE collection = $1`,
        [this.collection],
      );
      return Number((res.rows[0] as { c: number }).c);
    });
  }
}
