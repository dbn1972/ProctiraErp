/**
 * Process-local outbox store for unit tests and single-process proofs.
 */
import type { OutboxStore } from './store.js';
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
  };
}

export class InMemoryOutboxStore implements OutboxStore {
  private readonly rows = new Map<string, OutboxRecord>();

  async enqueue(entry: NewOutboxEntry, _client?: OutboxQueryable): Promise<OutboxRecord> {
    const record = toRecord(entry, new Date());
    this.rows.set(record.id, record);
    return { ...record };
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
    return due.map((r) => ({ ...r }));
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
      .map((r) => ({ ...r }));
  }

  /** Test helper */
  clear(): void {
    this.rows.clear();
  }

  get size(): number {
    return this.rows.size;
  }
}
