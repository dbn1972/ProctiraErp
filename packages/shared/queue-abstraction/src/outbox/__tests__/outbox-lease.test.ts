/**
 * PRC-M362 — outbox claim lease (visibility timeout).
 *
 * A claimed row is leased (status=processing, locked_until) so a second relay
 * (another replica) cannot claim it; the lease is reclaimed once it expires so
 * a crashed relay's row is not stranded. The in-memory store mirrors the
 * PgOutboxStore lease semantics, so these assertions describe the production
 * SQL path (also exercised live in pg-outbox-lease.live.test.ts).
 */
import { describe, it, expect } from 'vitest';

import { InMemoryOutboxStore } from '../in-memory-outbox-store.js';
import type { NewOutboxEntry } from '../types.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

function entry(id: string): NewOutboxEntry {
  return {
    id,
    tenantId: TENANT,
    aggregateType: 'lease_probe',
    aggregateId: id,
    eventType: 'probe.event',
    payload: { probe: true },
    // Available immediately in the past so claims at the test clock see it.
    availableAt: new Date('2025-12-31T00:00:00Z'),
  };
}

describe('PRC-M362 outbox claim lease', () => {
  it('a leased row is not re-claimed by a concurrent relay within the lease', async () => {
    const store = new InMemoryOutboxStore(60_000);
    await store.enqueue(entry('aaaaaaaa-0000-4000-8000-000000000001'));

    const now = new Date('2026-01-01T00:00:00Z');
    const relayA = await store.claimPending(10, now);
    expect(relayA).toHaveLength(1);

    // A second relay claiming 1ms later must see nothing: the row is leased.
    const relayB = await store.claimPending(10, new Date(now.getTime() + 1));
    expect(relayB).toHaveLength(0);
  });

  it('an expired lease is reclaimed (crashed relay recovery)', async () => {
    const store = new InMemoryOutboxStore(1_000);
    await store.enqueue(entry('aaaaaaaa-0000-4000-8000-000000000002'));

    const now = new Date('2026-01-01T00:00:00Z');
    const first = await store.claimPending(10, now);
    expect(first).toHaveLength(1);

    // Before the lease expires: still invisible.
    expect(await store.claimPending(10, new Date(now.getTime() + 500))).toHaveLength(0);

    // After expiry: reclaimed by the next relay.
    const reclaimed = await store.claimPending(10, new Date(now.getTime() + 1_500));
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]!.id).toBe('aaaaaaaa-0000-4000-8000-000000000002');
    // attempts reflects both claims.
    expect(reclaimed[0]!.attempts).toBe(2);
  });

  it('markPublished releases the lease and the row is never re-claimed', async () => {
    const store = new InMemoryOutboxStore(1_000);
    await store.enqueue(entry('aaaaaaaa-0000-4000-8000-000000000003'));
    const now = new Date('2026-01-01T00:00:00Z');
    const claimed = await store.claimPending(10, now);
    await store.markPublished(claimed[0]!.id);
    // Long after any lease would expire — published rows stay published.
    expect(await store.claimPending(10, new Date(now.getTime() + 10_000))).toHaveLength(0);
  });

  it('markFailed with retry returns the row to pending and clears the lease', async () => {
    const store = new InMemoryOutboxStore(1_000);
    await store.enqueue(entry('aaaaaaaa-0000-4000-8000-000000000004'));
    const now = new Date('2026-01-01T00:00:00Z');
    const claimed = await store.claimPending(10, now);
    await store.markFailed(claimed[0]!.id, 'boom', now); // availableAt=now => pending
    const retried = await store.claimPending(10, new Date(now.getTime() + 1));
    expect(retried).toHaveLength(1);
    // Stable identity across retries (PRC-M362 fix-step 5).
    expect(retried[0]!.id).toBe(claimed[0]!.id);
  });
});
