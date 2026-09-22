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
import type { NewOutboxEntry } from '../types.js';

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

    // This is the defect: claimPending filters status='pending', so the row is
    // permanently unreachable by the relay.
    const claimed = await store.claimPending(50);
    expect(claimed.map((r) => r.id)).not.toContain(id);

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

    const pending = await store.claimPending(50);
    const row = pending.find((r) => r.id === id);
    expect(row).toBeDefined();
    // claimPending increments, so 0 -> 1 proves the reset happened in SQL.
    expect(row?.attempts).toBe(1);
    expect(row?.redriveHistory).toHaveLength(1);
    expect(row?.redriveHistory[0]?.actor).toBe('ops@example.test');
    expect(row?.redriveHistory[0]?.reason).toBe('INC-101 broker recovered');
    // fromAttempts is captured from the pre-update value by the UPDATE itself.
    expect(row?.redriveHistory[0]?.fromAttempts).toBe(9);
  });

  it('appends rather than overwrites across repeated redrives', async () => {
    const id = '44444444-4444-4444-8444-000000000003';
    await seedFailed(id, TENANT_A, 3);

    await store.requeueFailed({ ids: [id], actor: 'first', reason: 'one' });
    // Put it back into failed to redrive a second time.
    await store.markFailed(id, 'failed again');
    await store.requeueFailed({ ids: [id], actor: 'second', reason: 'two' });

    const rows = await store.claimPending(50);
    const row = rows.find((r) => r.id === id);
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

    const first = await store.requeueFailed({ ids: [id], actor: 'ops', reason: 'r' });
    const second = await store.requeueFailed({ ids: [id], actor: 'ops', reason: 'r' });
    expect(first).toEqual([id]);
    expect(second).toEqual([]);
  });

  it('listFailed honours tenant, limit and since', async () => {
    const id = '44444444-4444-4444-8444-000000000005';
    await seedFailed(id);

    expect(await store.listFailed({ tenantId: TENANT_A, limit: 1 })).toHaveLength(1);
    const future = await store.listFailed({
      tenantId: TENANT_A,
      since: new Date(Date.now() + 3_600_000),
    });
    expect(future).toHaveLength(0);
  });
});
