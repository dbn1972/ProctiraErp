/**
 * V10 defect 1 — live PostgreSQL proof for outbox redrive.
 *
 * The in-memory store is not the production adapter. These tests run PgOutboxStore
 * against a real database so the SQL, the jsonb append, the `status='failed'`
 * predicate and the RLS interaction are all exercised rather than simulated.
 *
 * Skipped unless OUTBOX_LIVE_DATABASE_URL (or DATABASE_URL) is set, matching the
 * pattern used by the other *.live.test.ts files in this repo.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgOutboxStore } from '../pg-outbox-store.js';
import { InvalidOutboxIdError, PLATFORM_WIDE_REDRIVE } from '../store.js';
import type { NewOutboxEntry, OutboxRecord } from '../types.js';

const CONNECTION = process.env['OUTBOX_LIVE_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '';
const describeLive = CONNECTION ? describe : describe.skip;

const TENANT_A = '33333333-3333-4333-8333-333333333331';
const TENANT_B = '33333333-3333-4333-8333-333333333332';

function entry(id: string, tenantId = TENANT_A): NewOutboxEntry {
  return {
    id,
    tenantId,
    aggregateType: 'redrive_probe',
    aggregateId: id,
    eventType: 'probe.event',
    payload: { probe: true },
  };
}

describeLive('PgOutboxStore redrive, live (V10 defect 1)', () => {
  let pool: Pool;
  let store: PgOutboxStore;
  const createdIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: CONNECTION, max: 4 });
    store = new PgOutboxStore(pool);
    // Tenants must exist: transactional_outbox.tenant_id carries an FK (#342).
    const client = await pool.connect();
    try {
      await client.query(`SELECT set_config('app.platform_admin', '1', false)`);
      for (const [id, slug] of [
        [TENANT_A, 'redrive-probe-a'],
        [TENANT_B, 'redrive-probe-b'],
      ]) {
        await client.query(
          `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $2)
           ON CONFLICT (id) DO NOTHING`,
          [id, slug],
        );
      }
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    if (!pool) return;
    const client = await pool.connect();
    try {
      await client.query(`SELECT set_config('app.platform_admin', '1', false)`);
      if (createdIds.length > 0) {
        await client.query(`DELETE FROM transactional_outbox WHERE id = ANY($1::uuid[])`, [
          createdIds,
        ]);
      }
      await client.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]]);
    } finally {
      client.release();
    }
    await pool.end();
  });

  /**
   * Read one row by id under platform scope.
   *
   * Deliberately NOT `claimPending(50)`. That is platform-scoped and unfiltered, so it
   * increments `attempts` on up to 50 arbitrary rows belonging to other tenants and
   * other suites without ever publishing them, and it flakes the moment the database
   * holds 50 other due pending rows — the probe row is newest by `created_at` while
   * the claim order is ASC. An earlier version of this file used it and was both
   * destructive and order-dependent.
   */
  async function readRow(id: string): Promise<OutboxRecord | undefined> {
    const client = await pool.connect();
    try {
      await client.query(`SELECT set_config('app.platform_admin', '1', false)`);
      const res = await client.query(
        `SELECT status, attempts, last_error, redrive_history
           FROM transactional_outbox WHERE id = $1`,
        [id],
      );
      const row = res.rows[0] as
        | {
            status: string;
            attempts: number;
            last_error: string | null;
            redrive_history: unknown;
          }
        | undefined;
      if (!row) return undefined;
      const history =
        typeof row.redrive_history === 'string'
          ? JSON.parse(row.redrive_history)
          : row.redrive_history;
      return {
        status: row.status,
        attempts: row.attempts,
        lastError: row.last_error ?? undefined,
        redriveHistory: history,
      } as unknown as OutboxRecord;
    } finally {
      client.release();
    }
  }

  async function seedFailed(id: string, tenantId = TENANT_A, attempts = 7): Promise<void> {
    createdIds.push(id);
    await store.enqueue(entry(id, tenantId));
    const client = await pool.connect();
    try {
      await client.query(`SELECT set_config('app.platform_admin', '1', false)`);
      await client.query(
        `UPDATE transactional_outbox SET status='failed', attempts=$2, last_error='seeded'
          WHERE id = $1`,
        [id, attempts],
      );
    } finally {
      client.release();
    }
  }

  it('reproduces the one-way sink against a real database', async () => {
    const id = '44444444-4444-4444-8444-000000000001';
    await seedFailed(id);

    // This is the defect: claimPending filters status='pending', so the row stays
    // out of reach of the relay. Asserted on the row itself rather than by claiming a
    // batch, so this test does not mutate other suites' rows.
    expect((await readRow(id))?.status).toBe('failed');

    const failed = await store.listFailed({ tenantId: TENANT_A });
    expect(failed.map((r) => r.id)).toContain(id);
  });

  it('requeues a failed row to pending with attempts reset and history appended', async () => {
    const id = '44444444-4444-4444-8444-000000000002';
    await seedFailed(id, TENANT_A, 9);

    const requeued = await store.requeueFailed({
      ids: [id],
      actor: 'ops@example.test',
      reason: 'INC-101 broker recovered',
      tenantId: TENANT_A,
    });
    expect(requeued).toEqual([id]);

    const row = await readRow(id);
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(0);
    // Mirrors markPublished: the error that killed the row must not survive.
    expect(row?.lastError).toBeUndefined();
    expect(row?.redriveHistory).toHaveLength(1);
    expect(row?.redriveHistory[0]?.actor).toBe('ops@example.test');
    expect(row?.redriveHistory[0]?.reason).toBe('INC-101 broker recovered');
    // The load-bearing assertion. Postgres evaluates SET expressions against the OLD
    // row, so `jsonb_build_object(..., 'fromAttempts', attempts)` alongside
    // `attempts = 0` records 9, not 0. This reads 0 if that ever stops being true.
    expect(row?.redriveHistory[0]?.fromAttempts).toBe(9);
  });

  it('appends rather than overwrites across repeated redrives', async () => {
    const id = '44444444-4444-4444-8444-000000000003';
    await seedFailed(id, TENANT_A, 3);

    await store.requeueFailed({ ids: [id], actor: 'first', reason: 'one', tenantId: TENANT_A });
    // Put it back into failed to redrive a second time.
    await store.markFailed(id, 'failed again');
    await store.requeueFailed({ ids: [id], actor: 'second', reason: 'two', tenantId: TENANT_A });

    const row = await readRow(id);
    expect(row?.redriveHistory).toHaveLength(2);
    expect(row?.redriveHistory.map((h) => h.actor)).toEqual(['first', 'second']);
  });

  it('will not cross tenants when scoped', async () => {
    const idA = '44444444-4444-4444-8444-00000000000a';
    const idB = '44444444-4444-4444-8444-00000000000b';
    await seedFailed(idA, TENANT_A);
    await seedFailed(idB, TENANT_B);

    const requeued = await store.requeueFailed({
      ids: [idA, idB],
      actor: 'ops-a',
      reason: 'scoped',
      tenantId: TENANT_A,
    });
    expect(requeued).toEqual([idA]);

    const stillFailedB = await store.listFailed({ tenantId: TENANT_B });
    expect(stillFailedB.map((r) => r.id)).toContain(idB);
  });

  it('is idempotent in SQL: the second call moves nothing', async () => {
    const id = '44444444-4444-4444-8444-000000000004';
    await seedFailed(id);

    const first = await store.requeueFailed({
      ids: [id], actor: 'ops', reason: 'r', tenantId: TENANT_A,
    });
    const second = await store.requeueFailed({
      ids: [id], actor: 'ops', reason: 'r', tenantId: TENANT_A,
    });
    expect(first).toEqual([id]);
    expect(second).toEqual([]);
  });

  it('listFailed honours tenant, limit and since', async () => {
    const id = '44444444-4444-4444-8444-000000000005';
    await seedFailed(id);

    expect(await store.listFailed({ tenantId: TENANT_A, limit: 1 })).toHaveLength(1);
    const future = await store.listFailed({
      tenantId: TENANT_A,
      createdSince: new Date(Date.now() + 3_600_000),
    });
    expect(future).toHaveLength(0);
  });

  it('rejects a non-UUID id before touching the database', async () => {
    // Without the up-front check, `id = ANY($1::uuid[])` raises 22P02, the
    // withPlatformClient transaction rolls back, and NOTHING is redriven — with an
    // error naming neither the parameter nor the offending id.
    const id = '44444444-4444-4444-8444-000000000006';
    await seedFailed(id);

    await expect(
      store.requeueFailed({
        ids: [id, 'not-a-uuid'],
        actor: 'ops',
        reason: 'typo',
        tenantId: TENANT_A,
      }),
    ).rejects.toThrow(InvalidOutboxIdError);

    // The valid row is untouched, which is what Postgres would have done anyway —
    // the point is that the caller now learns which id was wrong.
    expect((await readRow(id))?.status).toBe('failed');
  });

  it('honours the explicit cross-tenant opt-in', async () => {
    const idA = '44444444-4444-4444-8444-00000000000c';
    const idB = '44444444-4444-4444-8444-00000000000d';
    await seedFailed(idA, TENANT_A);
    await seedFailed(idB, TENANT_B);

    const requeued = await store.requeueFailed({
      ids: [idA, idB],
      actor: 'platform-ops',
      reason: 'global outage',
      tenantId: PLATFORM_WIDE_REDRIVE,
    });
    expect(requeued.sort()).toEqual([idA, idB].sort());
  });

  it('can serve a tenant-scoped failed list from the partial index', async () => {
    // 102 exists to serve listFailed; without a check, a future change could drop it
    // and nothing would notice.
    //
    // `enable_seqscan = off` is deliberate. On a small table the planner correctly
    // prefers a sequential scan, so asserting the index appears in the default plan
    // would fail for a reason that says nothing about the index — the first version
    // of this test did exactly that. Forcing the choice tests what actually matters:
    // that the partial index is *applicable* to this query shape, i.e. its predicate
    // and column order match. If the index were dropped or its definition drifted,
    // the planner would fall back to a different index or a seq scan even with
    // seqscan disabled, and this fails.
    const client = await pool.connect();
    try {
      // BEGIN is required, not decoration: `SET LOCAL` outside a transaction is a
      // no-op for subsequent statements, so the first version of this test silently
      // kept seqscan enabled and failed for the wrong reason. ROLLBACK also stops the
      // setting leaking to the next borrower of this pooled connection.
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
      await client.query('SET LOCAL enable_seqscan = off');
      const res = await client.query(
        `EXPLAIN (FORMAT JSON)
         SELECT * FROM transactional_outbox
          WHERE status = 'failed' AND tenant_id = $1::uuid
          ORDER BY created_at DESC, id DESC LIMIT 100`,
        [TENANT_A],
      );
      expect(JSON.stringify(res.rows[0])).toContain('transactional_outbox_failed_idx');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
