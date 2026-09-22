/**
 * Process-local outbox store for unit tests and single-process proofs.
 */
import {
  assertValidOutboxIds,
  PLATFORM_WIDE_REDRIVE,
  type ListFailedOptions,
  type OutboxStore,
  type RequeueFailedOptions,
} from './store.js';
import type { NewOutboxEntry, OutboxQueryable, OutboxRecord } from './types.js';

function toRecord(entry: NewOutboxEntry, now: Date): OutboxRecord {
  return {
    ...entry,
    status: 'pending',
    attempts: 0,
    createdAt: now,
    availableAt: entry.availableAt ?? now,
    dispatchMode: entry.dispatchMode ?? 'dispatch',
    metadata: entry.metadata,
    redriveHistory: [],
  };
}

/**
 * Detach a record from the store.
 *
 * `{ ...r }` alone is not enough: the spread copies the `redriveHistory` *reference*,
 * so a caller could mutate stored state through a returned record. `PgOutboxStore`
 * materialises a fresh array from jsonb on every read, so sharing it here would let
 * the two implementations diverge in a way the tests could not see.
 */
function detach(r: OutboxRecord): OutboxRecord {
  return { ...r, redriveHistory: [...r.redriveHistory] };
}

export class InMemoryOutboxStore implements OutboxStore {
  private readonly rows = new Map<string, OutboxRecord>();

  async enqueue(entry: NewOutboxEntry, _client?: OutboxQueryable): Promise<OutboxRecord> {
    const record = toRecord(entry, new Date());
    this.rows.set(record.id, record);
    return detach(record);
  }

  async claimPending(limit: number, now: Date = new Date()): Promise<OutboxRecord[]> {
    const due = Array.from(this.rows.values())
      .filter((r) => r.status === 'pending' && r.availableAt.getTime() <= now.getTime())
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit);

    for (const row of due) {
      row.attempts += 1;
      this.rows.set(row.id, row);
    }
    return due.map(detach);
  }

  async markPublished(id: string, publishedAt: Date = new Date()): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.status = 'published';
    row.publishedAt = publishedAt;
    this.rows.set(id, row);
  }

  async markFailed(id: string, error: string, availableAt?: Date): Promise<void> {
    const row = this.rows.get(id);
    if (!row) return;
    row.lastError = error;
    if (availableAt) {
      row.status = 'pending';
      row.availableAt = availableAt;
    } else {
      row.status = 'failed';
    }
    this.rows.set(id, row);
  }

  async listPending(): Promise<OutboxRecord[]> {
    return Array.from(this.rows.values())
      .filter((r) => r.status === 'pending')
      .map(detach);
  }

  async listFailed(options: ListFailedOptions = {}): Promise<OutboxRecord[]> {
    const limit = options.limit ?? 100;
    const createdSince = options.createdSince;
    return (
      Array.from(this.rows.values())
        .filter((r) => r.status === 'failed')
        .filter((r) => options.tenantId === undefined || r.tenantId === options.tenantId)
        .filter(
          (r) => createdSince === undefined || r.createdAt.getTime() >= createdSince.getTime(),
        )
        // `id` breaks the tie so `limit` is deterministic for rows enqueued in the
        // same millisecond, matching the PG store's `ORDER BY created_at DESC, id DESC`.
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
        .slice(0, limit)
        .map(detach)
    );
  }

  async requeueFailed(options: RequeueFailedOptions): Promise<string[]> {
    const { ids, actor, reason, tenantId } = options;
    if (ids.length === 0) return [];
    if (!actor.trim()) throw new Error('requeueFailed: actor is required (Volume 5 §6 audit)');
    if (!reason.trim()) throw new Error('requeueFailed: reason is required (Volume 5 §6 audit)');
    // Same up-front rejection as PgOutboxStore. Without it this store would skip a
    // malformed id and report partial success while Postgres aborted the whole
    // batch — two contracts behind one interface, with the tests on the lenient one.
    assertValidOutboxIds(ids);

    const availableAt = options.availableAt ?? new Date();
    const at = new Date().toISOString();
    const requeued: string[] = [];

    for (const id of ids) {
      const row = this.rows.get(id);
      // Same predicate as the PG store: only `failed` rows move, and a tenant
      // filter narrows rather than partially applying.
      if (!row || row.status !== 'failed') continue;
      if (tenantId !== PLATFORM_WIDE_REDRIVE && row.tenantId !== tenantId) continue;

      row.redriveHistory = [
        ...row.redriveHistory,
        { at, actor, reason, fromAttempts: row.attempts },
      ];
      row.status = 'pending';
      row.attempts = 0;
      // Mirrors the PG store and markPublished: a requeued row must not carry the
      // error that killed it.
      row.lastError = undefined;
      row.availableAt = availableAt;
      this.rows.set(id, row);
      requeued.push(id);
    }
    return requeued;
  }

  /** Test helper */
  clear(): void {
    this.rows.clear();
  }

  get size(): number {
    return this.rows.size;
  }
}
