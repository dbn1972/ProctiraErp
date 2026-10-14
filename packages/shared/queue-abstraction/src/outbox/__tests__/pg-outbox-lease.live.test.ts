/**
 * PRC-M362 — live PostgreSQL proof for the outbox claim lease.
 *
 * Runs PgOutboxStore against a real database so the lease SQL (status=processing,
 * locked_until, the pending-or-expired-lease selection, FOR UPDATE SKIP LOCKED)
 * is exercised rather than simulated.
 *
 * Skipped unless OUTBOX_LIVE_DATABASE_URL (or DATABASE_URL) is set, matching the
 * other *.live.test.ts files in this package.
 */
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgOutboxStore } from '../pg-outbox-store.js';
import type { NewOutboxEntry } from '../types.js';

const CONNECTION = process.env['OUTBOX_LIVE_DATABASE_URL'] ?? process.env['DATABASE_URL'] ?? '';
const describeLive = CONNECTION ? describe : describe.skip;

const TENANT = '33333333-3333-4333-8333-333333333341';

function entry(id: string): NewOutboxEntry {
  return {
    id,
    tenantId: TENANT,
    aggregateType: 'lease_probe',
    aggregateId: id,
    eventType: 'probe.event',
    payload: { probe: true },
  };
}

describeLive('PgOutboxStore claim lease, live (PRC-M362)', () => {
  let pool: Pool;
  const createdIds: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: CONNECTION, max: 4 });
    const client = await pool.connect();
    try {
      await client.query(`SELECT set_config('app.platform_admin', '1', false)`);
      await client.query(
        `INSERT INTO tenants (id, name, slug) VALUES ($1, 'lease-probe', 'lease-probe')
         ON CONFLICT (id) DO NOTHING`,
        [TENANT],
      );
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
      await client.query(`DELETE FROM tenants WHERE id = $1`, [TENANT]);
    } finally {
      client.release();
    }
    await pool.end();
  });

  it('two relays over N rows each claim a disjoint set (no double-claim)', async () => {
    const store = new PgOutboxStore(pool, 60_000);
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const id = `44444444-0000-4000-8000-${String(i).padStart(12, '0')}`;
      ids.push(id);
      createdIds.push(id);
      await store.enqueue(entry(id));
    }
    const now = new Date();
    const [a, b] = await Promise.all([store.claimPending(20, now), store.claimPending(20, now)]);
    const claimedA = new Set(a.map((r) => r.id));
    const claimedB = new Set(b.map((r) => r.id));
    for (const id of claimedA) expect(claimedB.has(id)).toBe(false);
    // Every probe row claimed exactly once across the two relays.
    const union = new Set([...claimedA, ...claimedB]);
    for (const id of ids) expect(union.has(id)).toBe(true);
  });

  it('an expired lease is reclaimed after the lease window', async () => {
    const store = new PgOutboxStore(pool, 1_000);
    const id = '44444444-0000-4000-8000-ffffffffffff';
    createdIds.push(id);
    await store.enqueue(entry(id));

    const now = new Date();
    const first = (await store.claimPending(50, now)).map((r) => r.id);
    expect(first).toContain(id);

    // Within the lease: not reclaimed.
    const mid = (await store.claimPending(50, new Date(now.getTime() + 500))).map((r) => r.id);
    expect(mid).not.toContain(id);

    // After expiry: reclaimed.
    const after = (await store.claimPending(50, new Date(now.getTime() + 2_000))).map((r) => r.id);
    expect(after).toContain(id);
  });
});
