/**
 * PostgreSQL transactional outbox store (W2-JOB-04).
 * Table: transactional_outbox (db/sql/056_transactional_outbox_schema.sql).
 */
import type { OutboxStore } from './store.js';
import type {
  NewOutboxEntry,
  OutboxDispatchMode,
  OutboxQueryable,
  OutboxRecord,
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
}

function asDate(v: Date | string | null | undefined): Date | undefined {
  if (v == null) return undefined;
  return v instanceof Date ? v : new Date(String(v));
}

function mapRow(row: OutboxRow): OutboxRecord {
  const metadata = (row.metadata ?? {}) as OutboxRecord['metadata'];
  const dispatchMode =
    (metadata as { dispatchMode?: OutboxDispatchMode } | undefined)?.dispatchMode ?? 'dispatch';
  return {
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
  await pool.query(`SELECT set_config('app.platform_admin', '1', true)`);
  return fn(pool);
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
    const q = client ?? this.pool;

    const run = async (exec: OutboxQueryable) => {
      if (!client) {
        await exec.query(`SELECT set_config('app.tenant_id', $1, true)`, [entry.tenantId]);
        await exec.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [entry.tenantId]);
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
}
