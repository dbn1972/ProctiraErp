/**
 * PRC-H084: disbursement -> fees transactional outbox.
 *
 * When a disbursement flips to / away from `paid`, the status write and an
 * outbox row are committed in ONE transaction (see
 * `ScholarshipRepository.updateDisbursement(..., inTx)`). The fee netting hook
 * is then dispatched from the outbox: immediately (best effort) and again by
 * the retry worker / reconcile-replay job until it succeeds or is dead-lettered.
 *
 * The Postgres implementation targets table `scholarship_fee_outbox`
 * (migration owned by the schema batch). If the table is absent, `isAvailable()`
 * returns false and the service degrades to the legacy synchronous
 * hook-with-compensation path.
 */
import { withPgTenant, type PgQueryable } from '@proctira/database';
import { v4 as uuidv4 } from 'uuid';

export type ScholarshipFeeOutboxEvent = 'disbursement.paid' | 'disbursement.reversed';
export type ScholarshipFeeOutboxStatus = 'pending' | 'done' | 'failed';

export interface ScholarshipFeeOutboxRow {
  id: string;
  tenantId: string;
  disbursementId: string;
  event: ScholarshipFeeOutboxEvent;
  status: ScholarshipFeeOutboxStatus;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type NewScholarshipFeeOutboxRow = Pick<
  ScholarshipFeeOutboxRow,
  'tenantId' | 'disbursementId' | 'event'
>;

/** Transaction handle passed by the repository: a Pg client, or null (in-memory). */
export type ScholarshipTxClient = PgQueryable | null;

export interface ScholarshipFeeOutbox {
  /** False when the backing table is absent: callers must use the legacy path. */
  isAvailable(): Promise<boolean>;
  /** Insert a pending row on the caller's open transaction (`tx`), or directly when null. */
  enqueue(
    tx: ScholarshipTxClient,
    row: NewScholarshipFeeOutboxRow,
  ): Promise<ScholarshipFeeOutboxRow>;
  /** Pending rows due at `now`, oldest first. */
  listDue(tenantId: string, now: Date, limit: number): Promise<ScholarshipFeeOutboxRow[]>;
  /** Pending + failed rows (reconcile view), oldest first. */
  listOpen(tenantId: string, limit: number): Promise<ScholarshipFeeOutboxRow[]>;
  /** Pending + failed rows for one disbursement, oldest first (per-disbursement ordering). */
  listOpenForDisbursement(
    tenantId: string,
    disbursementId: string,
  ): Promise<ScholarshipFeeOutboxRow[]>;
  findById(tenantId: string, id: string): Promise<ScholarshipFeeOutboxRow | null>;
  markDone(tenantId: string, id: string): Promise<void>;
  /** Record a failed attempt; `status` stays pending (retry) or becomes failed (dead letter). */
  markAttemptFailed(
    tenantId: string,
    id: string,
    error: string,
    nextAttemptAt: Date,
    status: 'pending' | 'failed',
  ): Promise<void>;
  /** Reset a dead-lettered row back to pending for replay. */
  requeue(tenantId: string, id: string, now: Date): Promise<void>;
}

function newRow(row: NewScholarshipFeeOutboxRow, now = new Date()): ScholarshipFeeOutboxRow {
  return {
    id: uuidv4(),
    tenantId: row.tenantId,
    disbursementId: row.disbursementId,
    event: row.event,
    status: 'pending',
    attempts: 0,
    lastError: null,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

export class InMemoryScholarshipFeeOutbox implements ScholarshipFeeOutbox {
  private readonly rows = new Map<string, ScholarshipFeeOutboxRow>();
  private seq = 0;
  private readonly order = new Map<string, number>();

  async isAvailable(): Promise<boolean> {
    return true;
  }
  async enqueue(_tx: ScholarshipTxClient, row: NewScholarshipFeeOutboxRow) {
    const created = newRow(row);
    this.rows.set(created.id, created);
    this.order.set(created.id, this.seq++);
    return { ...created };
  }
  private sorted(tenantId: string): ScholarshipFeeOutboxRow[] {
    return [...this.rows.values()]
      .filter((r) => r.tenantId === tenantId)
      .sort((a, b) => (this.order.get(a.id) ?? 0) - (this.order.get(b.id) ?? 0));
  }
  async listDue(tenantId: string, now: Date, limit: number) {
    return this.sorted(tenantId)
      .filter((r) => r.status === 'pending' && r.nextAttemptAt.getTime() <= now.getTime())
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
  async listOpen(tenantId: string, limit: number) {
    return this.sorted(tenantId)
      .filter((r) => r.status !== 'done')
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
  async listOpenForDisbursement(tenantId: string, disbursementId: string) {
    return this.sorted(tenantId)
      .filter((r) => r.disbursementId === disbursementId && r.status !== 'done')
      .map((r) => ({ ...r }));
  }
  async findById(tenantId: string, id: string) {
    const row = this.rows.get(id);
    return row && row.tenantId === tenantId ? { ...row } : null;
  }
  private patch(tenantId: string, id: string, patch: Partial<ScholarshipFeeOutboxRow>) {
    const row = this.rows.get(id);
    if (!row || row.tenantId !== tenantId) return;
    this.rows.set(id, { ...row, ...patch, updatedAt: new Date() });
  }
  async markDone(tenantId: string, id: string) {
    const row = this.rows.get(id);
    this.patch(tenantId, id, { status: 'done', attempts: (row?.attempts ?? 0) + 1 });
  }
  async markAttemptFailed(
    tenantId: string,
    id: string,
    error: string,
    nextAttemptAt: Date,
    status: 'pending' | 'failed',
  ) {
    const row = this.rows.get(id);
    this.patch(tenantId, id, {
      status,
      attempts: (row?.attempts ?? 0) + 1,
      lastError: error,
      nextAttemptAt,
    });
  }
  async requeue(tenantId: string, id: string, now: Date) {
    this.patch(tenantId, id, { status: 'pending', nextAttemptAt: now });
  }
}

type PgPoolForOutbox = Parameters<typeof withPgTenant>[0];

function mapRow(raw: Record<string, unknown>): ScholarshipFeeOutboxRow {
  const d = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
  return {
    id: String(raw.id),
    tenantId: String(raw.tenant_id),
    disbursementId: String(raw.disbursement_id),
    event: String(raw.event) as ScholarshipFeeOutboxEvent,
    status: String(raw.status) as ScholarshipFeeOutboxStatus,
    attempts: Number(raw.attempts ?? 0),
    lastError: raw.last_error == null ? null : String(raw.last_error),
    nextAttemptAt: d(raw.next_attempt_at),
    createdAt: d(raw.created_at),
    updatedAt: d(raw.updated_at),
  };
}

/** Postgres outbox on `scholarship_fee_outbox` (RLS by tenant_id via withPgTenant). */
export class PgScholarshipFeeOutbox implements ScholarshipFeeOutbox {
  private available: boolean | null = null;

  constructor(private readonly pool: PgPoolForOutbox) {}

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    try {
      const res = await this.pool.query(
        `SELECT to_regclass('scholarship_fee_outbox') IS NOT NULL AS ok`,
      );
      const ok = Boolean((res.rows[0] as { ok?: unknown } | undefined)?.ok);
      // Cache only a positive answer so the table can appear after a later migration.
      if (ok) this.available = true;
      return ok;
    } catch {
      return false;
    }
  }

  async enqueue(tx: ScholarshipTxClient, row: NewScholarshipFeeOutboxRow) {
    const created = newRow(row);
    const insert = async (client: PgQueryable) => {
      const res = await client.query(
        `INSERT INTO scholarship_fee_outbox
           (id, tenant_id, disbursement_id, event, status, attempts, last_error,
            next_attempt_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'pending', 0, NULL, now(), now(), now())
         RETURNING *`,
        [created.id, created.tenantId, created.disbursementId, created.event],
      );
      return mapRow(res.rows[0] as Record<string, unknown>);
    };
    return tx ? insert(tx) : withPgTenant(this.pool, row.tenantId, insert);
  }

  async listDue(tenantId: string, now: Date, limit: number) {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM scholarship_fee_outbox
          WHERE tenant_id = $1 AND status = 'pending' AND next_attempt_at <= $2
          ORDER BY created_at ASC, id ASC LIMIT $3`,
        [tenantId, now, limit],
      );
      return res.rows.map((r) => mapRow(r as Record<string, unknown>));
    });
  }

  async listOpen(tenantId: string, limit: number) {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM scholarship_fee_outbox
          WHERE tenant_id = $1 AND status <> 'done'
          ORDER BY created_at ASC, id ASC LIMIT $2`,
        [tenantId, limit],
      );
      return res.rows.map((r) => mapRow(r as Record<string, unknown>));
    });
  }

  async listOpenForDisbursement(tenantId: string, disbursementId: string) {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM scholarship_fee_outbox
          WHERE tenant_id = $1 AND disbursement_id = $2 AND status <> 'done'
          ORDER BY created_at ASC, id ASC`,
        [tenantId, disbursementId],
      );
      return res.rows.map((r) => mapRow(r as Record<string, unknown>));
    });
  }

  async findById(tenantId: string, id: string) {
    return withPgTenant(this.pool, tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM scholarship_fee_outbox WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      return res.rows[0] ? mapRow(res.rows[0] as Record<string, unknown>) : null;
    });
  }

  async markDone(tenantId: string, id: string) {
    await withPgTenant(this.pool, tenantId, (client) =>
      client.query(
        `UPDATE scholarship_fee_outbox
            SET status = 'done', attempts = attempts + 1, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      ),
    );
  }

  async markAttemptFailed(
    tenantId: string,
    id: string,
    error: string,
    nextAttemptAt: Date,
    status: 'pending' | 'failed',
  ) {
    await withPgTenant(this.pool, tenantId, (client) =>
      client.query(
        `UPDATE scholarship_fee_outbox
            SET status = $3, attempts = attempts + 1, last_error = $4,
                next_attempt_at = $5, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, status, error.slice(0, 2000), nextAttemptAt],
      ),
    );
  }

  async requeue(tenantId: string, id: string, now: Date) {
    await withPgTenant(this.pool, tenantId, (client) =>
      client.query(
        `UPDATE scholarship_fee_outbox
            SET status = 'pending', next_attempt_at = $3, updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id, now],
      ),
    );
  }
}

/** Exponential backoff for retry `attempt` (1-based), capped at 30 minutes. */
export function outboxBackoffMs(attempt: number): number {
  return Math.min(30 * 60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}
