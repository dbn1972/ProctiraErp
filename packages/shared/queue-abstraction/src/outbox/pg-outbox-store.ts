/**
 * PostgreSQL transactional outbox store (W2-JOB-04).
 * Table: transactional_outbox (db/sql/056_transactional_outbox_schema.sql).
 */
import {
  assertValidOutboxIds,
  PLATFORM_WIDE_REDRIVE,
  type ListFailedOptions,
  type OutboxStore,
  type RequeueFailedOptions,
} from './store.js';
import type {
  NewOutboxEntry,
  OutboxDispatchMode,
  OutboxQueryable,
  OutboxRecord,
  OutboxRedriveEntry,
  OutboxStatus,
} from './types.js';

interface OutboxRow {
  id: string;
  tenant_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  metadata: unknown;
  status: string;
  attempts: number;
  last_error: string | null;
  available_at: Date | string;
  created_at: Date | string;
  published_at: Date | string | null;
  redrive_history?: unknown;
}

function asDate(v: Date | string | null | undefined): Date | undefined {
  if (v == null) return undefined;
  return v instanceof Date ? v : new Date(String(v));
}

/**
 * `redrive_history` is jsonb. Tolerate a string (some drivers hand back raw json)
 * and anything unexpected, because a malformed audit column must not break the
 * read path for the row it annotates.
 */
function mapRedriveHistory(value: unknown): OutboxRedriveEntry[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((e): e is OutboxRedriveEntry => {
    if (typeof e !== 'object' || e === null) return false;
    const c = e as Record<string, unknown>;
    return (
      typeof c.at === 'string' &&
      typeof c.actor === 'string' &&
      typeof c.reason === 'string' &&
      // Checked so the declared `fromAttempts: number` is not a lie at runtime.
      typeof c.fromAttempts === 'number'
    );
  });
}

function mapRow(row: OutboxRow): OutboxRecord {
  const metadata = (row.metadata ?? {}) as OutboxRecord['metadata'];
  const dispatchMode =
    (metadata as { dispatchMode?: OutboxDispatchMode } | undefined)?.dispatchMode ?? 'dispatch';
  return {
    redriveHistory: mapRedriveHistory(row.redrive_history),
    id: row.id,
    tenantId: row.tenant_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload: row.payload,
    metadata,
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    lastError: row.last_error ?? undefined,
    availableAt: asDate(row.available_at) ?? new Date(),
    createdAt: asDate(row.created_at) ?? new Date(),
    publishedAt: asDate(row.published_at ?? undefined),
    dispatchMode,
  };
}

/**
 * Pool or client that can either run queries directly or check out a client
 * for BEGIN/COMMIT (platform-admin claim path).
 */
export interface PgOutboxPool extends OutboxQueryable {
  connect?: () => Promise<OutboxQueryable & { release: () => void }>;
}

async function withPlatformClient<T>(
  pool: PgOutboxPool,
  fn: (client: OutboxQueryable) => Promise<T>,
): Promise<T> {
  if (typeof pool.connect === 'function') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
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
  // No `connect`, so there is no transaction to scope the GUC to. `set_config(..., true)`
  // is transaction-local, so it would not survive to the next statement: RLS would
  // then filter everything and `requeueFailed` would return `[]`, which its contract
  // says means "nothing was in failed". A silent wrong answer on an operator-facing
  // path is worse than an error, so refuse instead.
  //
  // Production always supplies a pg.Pool (both factories do), so this is a
  // misuse guard rather than a live code path.
  throw new Error(
    'PgOutboxStore requires a pool with connect() for platform-scoped reads. ' +
      'A bare queryable cannot hold the transaction-local app.platform_admin GUC, ' +
      'so RLS would silently return zero rows instead of failing.',
  );
}

function metadataJson(entry: NewOutboxEntry): string {
  const meta = {
    ...(entry.metadata ?? {}),
    dispatchMode: entry.dispatchMode ?? 'dispatch',
  };
  return JSON.stringify(meta);
}

export class PgOutboxStore implements OutboxStore {
  constructor(private readonly pool: PgOutboxPool) {}

  async enqueue(entry: NewOutboxEntry, client?: OutboxQueryable): Promise<OutboxRecord> {
    const now = new Date();
    const availableAt = entry.availableAt ?? now;
    const dispatchMode = entry.dispatchMode ?? 'dispatch';

    const run = async (exec: OutboxQueryable) => {
      if (!client) {
        // W1-DATA-12: canonical app.tenant_id + legacy alias sync (same contract as bindTenantGuc).
        await exec.query(
          `SELECT set_config('app.tenant_id', $1, true), set_config('app.current_tenant_id', $1, true)`,
          [entry.tenantId],
        );
      }
      await exec.query(
        `INSERT INTO transactional_outbox (
           id, tenant_id, aggregate_type, aggregate_id, event_type,
           payload, metadata, status, attempts, available_at, created_at
         ) VALUES (
           $1, $2, $3, $4, $5,
           $6::jsonb, $7::jsonb, 'pending', 0, $8, $9
         )`,
        [
          entry.id,
          entry.tenantId,
          entry.aggregateType,
          entry.aggregateId,
          entry.eventType,
          JSON.stringify(entry.payload),
          metadataJson(entry),
          availableAt.toISOString(),
          now.toISOString(),
        ],
      );
    };

    if (client) {
      await run(client);
    } else if (typeof this.pool.connect === 'function') {
      const c = await this.pool.connect();
      try {
        await c.query('BEGIN');
        await run(c);
        await c.query('COMMIT');
      } catch (err) {
        try {
          await c.query('ROLLBACK');
        } catch {
          // ignore
        }
        throw err;
      } finally {
        c.release();
      }
    } else {
      await run(this.pool);
    }

    return {
      ...entry,
      status: 'pending',
      attempts: 0,
      createdAt: now,
      availableAt,
      dispatchMode,
      redriveHistory: [],
    };
  }

  async claimPending(limit: number, now: Date = new Date()): Promise<OutboxRecord[]> {
    return withPlatformClient(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE transactional_outbox
         SET attempts = attempts + 1
         WHERE id IN (
           SELECT id FROM transactional_outbox
           WHERE status = 'pending' AND available_at <= $1
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT $2
         )
         RETURNING *`,
        [now.toISOString(), limit],
      );
      return (result.rows as OutboxRow[]).map(mapRow);
    });
  }

  async markPublished(id: string, publishedAt: Date = new Date()): Promise<void> {
    await withPlatformClient(this.pool, async (client) => {
      await client.query(
        `UPDATE transactional_outbox
         SET status = 'published', published_at = $2, last_error = NULL
         WHERE id = $1`,
        [id, publishedAt.toISOString()],
      );
    });
  }

  async markFailed(id: string, error: string, availableAt?: Date): Promise<void> {
    await withPlatformClient(this.pool, async (client) => {
      if (availableAt) {
        await client.query(
          `UPDATE transactional_outbox
           SET status = 'pending', last_error = $2, available_at = $3
           WHERE id = $1`,
          [id, error, availableAt.toISOString()],
        );
      } else {
        await client.query(
          `UPDATE transactional_outbox
           SET status = 'failed', last_error = $2
           WHERE id = $1`,
          [id, error],
        );
      }
    });
  }

  async listPending(): Promise<OutboxRecord[]> {
    return withPlatformClient(this.pool, async (client) => {
      const result = await client.query(
        `SELECT * FROM transactional_outbox WHERE status = 'pending' ORDER BY created_at ASC`,
      );
      return (result.rows as OutboxRow[]).map(mapRow);
    });
  }

  async listFailed(options: ListFailedOptions = {}): Promise<OutboxRecord[]> {
    const limit = options.limit ?? 100;
    return withPlatformClient(this.pool, async (client) => {
      const result = await client.query(
        `SELECT * FROM transactional_outbox
          WHERE status = 'failed'
            AND ($1::uuid IS NULL OR tenant_id = $1::uuid)
            AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)
          ORDER BY created_at DESC, id DESC
          LIMIT $3`,
        [options.tenantId ?? null, options.createdSince?.toISOString() ?? null, limit],
      );
      return (result.rows as OutboxRow[]).map(mapRow);
    });
  }

  async requeueFailed(options: RequeueFailedOptions): Promise<string[]> {
    const { ids, actor, reason, tenantId } = options;
    if (ids.length === 0) return [];
    if (!actor.trim()) throw new Error('requeueFailed: actor is required (Volume 5 §6 audit)');
    if (!reason.trim()) throw new Error('requeueFailed: reason is required (Volume 5 §6 audit)');
    // Reject a malformed batch before touching the database. `id = ANY($1::uuid[])`
    // raises 22P02 on the first bad element, which rolls back the transaction and
    // redrives nothing while naming neither the parameter nor the offending id.
    assertValidOutboxIds(ids);

    const availableAt = options.availableAt ?? new Date();
    const tenantFilter = tenantId === PLATFORM_WIDE_REDRIVE ? null : tenantId;

    return withPlatformClient(this.pool, async (client) => {
      // `status = 'failed'` in the WHERE clause is what makes this safe to retry:
      // a redrive applied twice affects nothing the second time, because the first
      // already moved the row out of `failed`.
      //
      // `attempts = 0` is required, not cosmetic — OutboxRelay.tick re-fails a row
      // immediately when attempts >= maxAttempts, so preserving the exhausted
      // counter would make the redrive a no-op on the next error.
      //
      // `last_error = NULL` mirrors markPublished. Without it the row returns to
      // `pending` still carrying the error that killed it, so any operator view
      // shows a stale failure against a healthy row. The error is not lost — it is
      // already in redrive_history's surrounding context and the relay rewrites
      // last_error on the next genuine failure.
      //
      // `jsonb_build_object(..., 'fromAttempts', attempts)` reads the PRE-update
      // value: Postgres evaluates every SET expression against the old row, so this
      // records how exhausted the row was, not the 0 being written beside it.
      const result = await client.query(
        `UPDATE transactional_outbox
            SET status = 'pending',
                attempts = 0,
                last_error = NULL,
                available_at = $2::timestamptz,
                redrive_history = redrive_history || jsonb_build_object(
                  'at',           $3::text,
                  'actor',        $4::text,
                  'reason',       $5::text,
                  'fromAttempts', attempts
                )
          WHERE id = ANY($1::uuid[])
            AND status = 'failed'
            AND ($6::uuid IS NULL OR tenant_id = $6::uuid)
          RETURNING id`,
        [ids, availableAt.toISOString(), new Date().toISOString(), actor, reason, tenantFilter],
      );
      return (result.rows as { id: string }[]).map((r) => r.id);
    });
  }
}
