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
import { withPgTenant, type PgPoolWithConnect, type PgQueryable } from './pg-tenant';
import { bindTenantGuc } from './tenant-guc';

/**
 * PRC-H007 / PRC-H116: a write addressed a `(collection, id)` that already
 * belongs to a different owner (another tenant, or the platform). The store
 * refuses to re-parent or overwrite it.
 */
export class DocumentOwnershipConflictError extends Error {
  readonly code = 'DOCUMENT_OWNERSHIP_CONFLICT';
  constructor(collection: string, id: string) {
    super(`control-plane document ${collection}/${id} is owned by a different scope`);
    this.name = 'DocumentOwnershipConflictError';
  }
}

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
 * Which rows a document operation is allowed to address.
 *
 * `control_plane_documents` holds both tenant-owned rows (`auth.*`, `billing.*`)
 * and genuinely platform-owned rows with a NULL `tenant_id`. Historically
 * `get`/`delete`/`all`/`count` carried **no** `tenant_id` predicate and relied
 * entirely on RLS for separation — while {@link withPlatformScope} bound
 * `app.platform_admin='1'`, which that table's policy accepts as a full escape.
 * The net effect was that `(collection, id)` behaved as a global key: a caller
 * holding an id read that row whichever tenant owned it. Verified live; see
 * `docs/audits/SEC_CONTROL_PLANE_DOCUMENT_ISOLATION.md`.
 *
 * Passing a scope adds the missing predicate in SQL, so the operation is correct
 * independently of whether RLS is escaped:
 *
 * - `{ tenantId }` — only that tenant's rows
 * - `{ platform: true }` — only rows with no owning tenant
 *
 * Omitting it preserves the previous unscoped behaviour, so this is additive and
 * no existing caller changes meaning. Omission is the thing being removed: once
 * call sites are classified, the parameter becomes required and the
 * `app.platform_admin` bind can stop being unconditional.
 */
export type DocumentScope =
  { tenantId: string; platform?: never } | { platform: true; tenantId?: never };

/**
 * Renders `scope` as an additional SQL predicate plus its parameters.
 * `nextParam` is the 1-based index of the next free placeholder.
 */
function scopeClause(
  scope: DocumentScope | undefined,
  nextParam: number,
): { sql: string; params: unknown[] } {
  if (!scope) return { sql: '', params: [] };
  if (scope.platform === true) return { sql: ' AND tenant_id IS NULL', params: [] };
  return {
    sql: ` AND tenant_id = $${nextParam}`,
    params: [canonicalizeDocumentTenantId(scope.tenantId)],
  };
}

/**
 * PRC-H007 / PRC-H116: `control_plane_documents.tenant_id` is a `uuid` column
 * (db/sql/100), and its RLS policy compares `tenant_id::text` — always a
 * canonical lowercase uuid — against `current_setting('app.tenant_id')`, which
 * is the id {@link withPgTenant} binds verbatim.
 *
 * Tenant ids reach the store from JWT claims, URL params and provisioning code,
 * and a uuid is case-insensitive: `3B6DF0A2-…` and `3b6df0a2-…` denote the same
 * tenant. Postgres normalises the written value to lowercase, so a non-canonical
 * bound GUC no longer equalled `tenant_id::text` once tenant-addressed ops stopped
 * taking the `app.platform_admin` escape. The write's WITH CHECK then failed with
 * 42501 (surfaced as a spurious {@link DocumentOwnershipConflictError}) and
 * `byTenant`/`all`/`where` reads matched nothing — breaking first access for any
 * tenant whose id was not already lowercase.
 *
 * Canonicalising a uuid-shaped id to lowercase before it is bound and stored keeps
 * the GUC equal to `tenant_id::text` without weakening isolation: the id still
 * identifies exactly one tenant. Non-uuid ids (health stores use TEXT tenant ids)
 * are left untouched — they are not stored in this uuid column.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function canonicalizeDocumentTenantId<T extends string | null | undefined>(tenantId: T): T {
  return (
    typeof tenantId === 'string' && UUID_SHAPE.test(tenantId) ? tenantId.toLowerCase() : tenantId
  ) as T;
}

/**
 * Runs `fn` on a dedicated client with `app.platform_admin = '1'` bound
 * (transaction-local), so RLS policies that allow the control plane pass.
 * When `tenantId` is given, the canonical tenant GUC is bound (W1-DATA-12).
 */
export async function withPlatformScope<T>(
  pool: PgPoolWithConnect | PgQueryable,
  fn: (client: PgQueryable) => Promise<T>,
  tenantId?: string | null,
): Promise<T> {
  const bind = async (client: PgQueryable) => {
    await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
    if (tenantId) {
      await bindTenantGuc(client, tenantId);
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

/**
 * Revive ISO-8601 strings into Dates.
 *
 * - Without `keys`: every ISO-looking string at any depth (legacy behaviour).
 * - With `keys` (PRC-L352): only string values stored under those property names
 *   (at any depth); other ISO-looking strings such as codes stay strings.
 */
export function reviveDates<T>(value: T, keys?: readonly string[]): T {
  return reviveInner(value, keys ? new Set(keys) : undefined, true) as T;
}

function reviveInner(value: unknown, keys: Set<string> | undefined, eligible: boolean): unknown {
  if (typeof value === 'string') {
    return eligible && ISO_DATE.test(value) ? new Date(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => reviveInner(v, keys, eligible));
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = reviveInner(v, keys, keys ? keys.has(k) : true);
    }
    return out;
  }
  return value;
}

export interface PgDocumentCollectionOptions {
  /**
   * Date revival for stored JSON:
   * - `true` (default, legacy): revive every ISO-looking string.
   * - `false`: return stored JSON untouched.
   * - `string[]` (PRC-L352, preferred): revive only these property names.
   */
  reviveDates?: boolean | readonly string[];
}

export class PgDocumentCollection<T extends object> {
  constructor(
    private readonly pool: PgPoolWithConnect | PgQueryable,
    private readonly collection: string,
    private readonly options: PgDocumentCollectionOptions = { reviveDates: true },
  ) {}

  private reviveData(raw: T): T {
    const mode = this.options.reviveDates ?? true;
    if (mode === false) return raw;
    return mode === true ? reviveDates(raw) : reviveDates(raw, mode);
  }

  private map(row: Record<string, unknown>): DocumentRow<T> {
    const raw = row.data as T;
    return {
      id: String(row.id),
      tenantId: row.tenant_id == null ? null : String(row.tenant_id),
      data: this.reviveData(raw),
      createdAt: toDate(row.created_at),
      updatedAt: toDate(row.updated_at),
    };
  }

  /**
   * PRC-H007 / PRC-H116: tenant-addressed operations bind `app.tenant_id` and
   * never `app.platform_admin`, so FORCE RLS on control_plane_documents is a
   * real second line of defence rather than an always-taken escape. Only
   * platform-addressed (or legacy unscoped) operations use the platform escape.
   */
  private run<R>(tenantId: string | null | undefined, fn: (client: PgQueryable) => Promise<R>) {
    const canonical = canonicalizeDocumentTenantId(tenantId);
    return canonical ? withPgTenant(this.pool, canonical, fn) : withPlatformScope(this.pool, fn);
  }

  async get(id: string, scope?: DocumentScope): Promise<T | null> {
    const s = scopeClause(scope, 3);
    return this.run(scope?.tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM control_plane_documents WHERE collection = $1 AND id = $2${s.sql} LIMIT 1`,
        [this.collection, id, ...s.params],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? this.map(row).data : null;
    });
  }

  async put(id: string, data: T, tenantId: string | null = null): Promise<T> {
    const owner = canonicalizeDocumentTenantId(tenantId);
    return this.ownershipGuard(id, () =>
      this.run(owner, async (client) => {
        // PRC-H116: never re-parent. An existing row owned by a different scope
        // is left untouched and the write is refused (no RETURNING row).
        const res = await client.query(
          `INSERT INTO control_plane_documents (collection, id, tenant_id, data)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (collection, id)
           DO UPDATE SET data = EXCLUDED.data, updated_at = now()
           WHERE control_plane_documents.tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id
           RETURNING *`,
          [this.collection, id, owner, JSON.stringify(data)],
        );
        const row = res.rows[0] as Record<string, unknown> | undefined;
        if (!row) throw new DocumentOwnershipConflictError(this.collection, id);
        return this.map(row).data;
      }),
    );
  }

  /**
   * Insert only when `(collection, id)` is free; otherwise return the existing
   * document unchanged. Concurrent callers all observe the single winner
   * (INSERT ... ON CONFLICT DO NOTHING), unlike `put` which is last-write-wins.
   * An existing row owned by a different scope is never returned (PRC-H116).
   */
  async insertIfAbsent(id: string, data: T, tenantId: string | null = null): Promise<T> {
    const owner = canonicalizeDocumentTenantId(tenantId);
    return this.ownershipGuard(id, () =>
      this.run(owner, async (client) => {
        const inserted = await client.query(
          `INSERT INTO control_plane_documents (collection, id, tenant_id, data)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (collection, id) DO NOTHING
           RETURNING *`,
          [this.collection, id, owner, JSON.stringify(data)],
        );
        const row = (inserted.rows[0] ??
          (
            await client.query(
              `SELECT * FROM control_plane_documents
               WHERE collection = $1 AND id = $2 AND tenant_id IS NOT DISTINCT FROM $3 LIMIT 1`,
              [this.collection, id, owner],
            )
          ).rows[0]) as Record<string, unknown> | undefined;
        if (!row) throw new DocumentOwnershipConflictError(this.collection, id);
        return this.map(row).data;
      }),
    );
  }

  /**
   * Under tenant binding, Postgres rejects an ON CONFLICT update of a row the
   * tenant cannot see with an RLS error (42501). Report it as the same
   * ownership conflict the platform path raises.
   */
  private async ownershipGuard<R>(id: string, fn: () => Promise<R>): Promise<R> {
    try {
      return await fn();
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === '42501') {
        throw new DocumentOwnershipConflictError(this.collection, id);
      }
      throw err;
    }
  }

  async delete(id: string, scope?: DocumentScope): Promise<boolean> {
    const s = scopeClause(scope, 3);
    return this.run(scope?.tenantId, async (client) => {
      const res = await client.query(
        `DELETE FROM control_plane_documents WHERE collection = $1 AND id = $2${s.sql}`,
        [this.collection, id, ...s.params],
      );
      return Number(res.rowCount ?? 0) > 0;
    });
  }

  async all(scope?: DocumentScope): Promise<T[]> {
    const s = scopeClause(scope, 2);
    return this.run(scope?.tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM control_plane_documents WHERE collection = $1${s.sql} ORDER BY created_at ASC`,
        [this.collection, ...s.params],
      );
      return res.rows.map((r) => this.map(r as Record<string, unknown>).data);
    });
  }

  async byTenant(tenantId: string): Promise<T[]> {
    const owner = canonicalizeDocumentTenantId(tenantId);
    return this.run(owner, async (client) => {
      const res = await client.query(
        `SELECT * FROM control_plane_documents
         WHERE collection = $1 AND tenant_id = $2 ORDER BY created_at ASC`,
        [this.collection, owner],
      );
      return res.rows.map((r) => this.map(r as Record<string, unknown>).data);
    });
  }

  /** Find documents where `data @> $criteria` (JSONB containment). */
  async where(criteria: Partial<T>, tenantId?: string): Promise<T[]> {
    const owner = canonicalizeDocumentTenantId(tenantId);
    return this.run(owner, async (client) => {
      const params: unknown[] = [this.collection, JSON.stringify(criteria)];
      let sql = `SELECT * FROM control_plane_documents WHERE collection = $1 AND data @> $2::jsonb`;
      if (owner) {
        params.push(owner);
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

  async count(scope?: DocumentScope): Promise<number> {
    const s = scopeClause(scope, 2);
    return this.run(scope?.tenantId, async (client) => {
      const res = await client.query(
        `SELECT COUNT(*)::int AS c FROM control_plane_documents WHERE collection = $1${s.sql}`,
        [this.collection, ...s.params],
      );
      return Number((res.rows[0] as { c: number }).c);
    });
  }
}
