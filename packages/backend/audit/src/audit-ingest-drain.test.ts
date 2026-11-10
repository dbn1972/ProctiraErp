/**
 * PRC-M200 / DR4-4 — audit ingest drain (scheduler + seal discipline).
 *
 * Unit-level coverage of the drain engine over an in-memory {@link QueueSealer}
 * that models the per-tenant head lock, the queue, the double-seal guard and
 * tenant isolation. The cross-tenant 42501 guards and the real definer-function
 * behaviour are proven separately on live Postgres (pg-audit-chain-keyed.live).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  computeKeyedEntryHash,
  verifyKeyedEntrySequence,
  type AuditChainKey,
  type AuditChainKeyResolver,
} from './audit-hash.js';
import type { AuditLogEntry } from './audit-repository.js';
import {
  createAuditIngestDrain,
  type PendingAuditQueueRow,
  type QueueSealer,
  type SealArgs,
  type TenantSealOps,
} from './audit-ingest-drain.js';

const KEY: AuditChainKey = { keyId: 'k1', secret: 'test-key-k1-0123456789abcdef' };
const resolve: AuditChainKeyResolver = (id) => (id === 'k1' ? KEY : undefined);

interface SealedEntry extends AuditLogEntry {}

/**
 * In-memory sealer: one chain head + queue per tenant. `seal` enforces the same
 * invariants as audit_ingest_seal (double-seal raises, head advances, queue row
 * marked) and records the produced AuditLogEntry so a test can verify the chain.
 */
function createFakeSealer(seed: Record<string, PendingAuditQueueRow[]>) {
  const queues = new Map<string, PendingAuditQueueRow[]>(Object.entries(seed));
  const sealedIds = new Map<string, Set<number>>();
  const heads = new Map<string, { seq: number; hash: string | null }>();
  const entries = new Map<string, SealedEntry[]>();
  let entryCounter = 0;
  const seals: SealArgs[] = [];

  const sealer: QueueSealer = {
    async listPendingTenants() {
      const out: string[] = [];
      for (const [tenantId, rows] of queues) {
        const sealedSet = sealedIds.get(tenantId) ?? new Set();
        if (rows.some((r) => !sealedSet.has(r.queueId))) out.push(tenantId);
      }
      return out.sort();
    },
    async withTenant<T>(tenantId: string, fn: (ops: TenantSealOps) => Promise<T>): Promise<T> {
      const ops: TenantSealOps = {
        async lockHead() {
          const h = heads.get(tenantId) ?? { seq: 0, hash: null };
          return { headSeq: h.seq, headHash: h.hash };
        },
        async loadPending() {
          const sealedSet = sealedIds.get(tenantId) ?? new Set();
          return (queues.get(tenantId) ?? [])
            .filter((r) => !sealedSet.has(r.queueId))
            .sort((a, b) => a.queueId - b.queueId);
        },
        async seal(args: SealArgs) {
          const sealedSet = sealedIds.get(tenantId) ?? new Set<number>();
          if (sealedSet.has(args.queueId)) {
            throw new Error(`already sealed: ${args.queueId}`); // double-seal guard
          }
          const head = heads.get(tenantId) ?? { seq: 0, hash: null };
          const row = (queues.get(tenantId) ?? []).find((r) => r.queueId === args.queueId)!;
          const seq = head.seq + 1;
          const entry: SealedEntry = {
            id: args.entryId,
            tenantId,
            entityType: row.entityType,
            entityId: row.entityId,
            operation: row.operation,
            userId: row.userId ?? row.actorKind,
            userName: row.userName,
            ipAddress: row.ipAddress,
            timestamp: row.occurredAt,
            beforeValues: row.beforeValues,
            afterValues: row.afterValues,
            metadata: row.metadata,
            chainSeq: seq,
            prevHash: head.hash,
            entryHash: args.entryHash,
            keyId: args.keyId,
          };
          heads.set(tenantId, { seq, hash: args.entryHash });
          sealedSet.add(args.queueId);
          sealedIds.set(tenantId, sealedSet);
          const list = entries.get(tenantId) ?? [];
          list.push(entry);
          entries.set(tenantId, list);
          seals.push(args);
        },
      };
      return fn(ops);
    },
    newEntryId() {
      entryCounter += 1;
      return `00000000-0000-4000-8000-${String(entryCounter).padStart(12, '0')}`;
    },
  };

  return { sealer, entries, seals, heads };
}

function queueRow(
  queueId: number,
  overrides: Partial<PendingAuditQueueRow> = {},
): PendingAuditQueueRow {
  return {
    queueId,
    tenantId: 'tenant-a',
    entityType: 'student',
    entityId: `student-${queueId}`,
    operation: 'UPDATE',
    userId: null,
    actorKind: 'system:demo-seed',
    userName: 'system',
    ipAddress: '0.0.0.0',
    occurredAt: new Date(`2026-09-01T10:00:0${queueId % 10}.000Z`),
    beforeValues: null,
    afterValues: { seeded: true },
    metadata: { queueId },
    ...overrides,
  };
}

describe('createAuditIngestDrain', () => {
  it('seals pending rows oldest-first into a contiguous keyed chain the verifier accepts', async () => {
    const rows = [queueRow(3), queueRow(1), queueRow(2)]; // out of order on purpose
    const { sealer, entries } = createFakeSealer({ 'tenant-a': rows });
    const drain = createAuditIngestDrain({ sealer, key: () => KEY });

    const result = await drain.runOnce();

    expect(result).toEqual({ tenants: 1, sealed: 3, failures: [] });
    const chain = entries.get('tenant-a')!;
    // Sealed in queue-id order 1,2,3 with contiguous chain_seq.
    expect(chain.map((e) => e.chainSeq)).toEqual([1, 2, 3]);
    expect(chain.map((e) => (e.metadata as { queueId: number }).queueId)).toEqual([1, 2, 3]);
    // Each entryHash matches the in-process HMAC and links to the previous.
    let prev: string | null = null;
    for (const e of chain) {
      expect(e.keyId).toBe('k1');
      expect(e.prevHash).toBe(prev);
      expect(e.entryHash).toBe(computeKeyedEntryHash(e, prev, KEY));
      prev = e.entryHash;
    }
    const verification = verifyKeyedEntrySequence('tenant-a', chain, resolve, { cutoverSeq: 0 });
    expect(verification.valid).toBe(true);
  });

  it('is single-flight: a concurrent second drain seals nothing more (no double seal)', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => queueRow(i + 1));
    const { sealer, entries, seals } = createFakeSealer({ 'tenant-a': rows });
    const drain = createAuditIngestDrain({ sealer, key: () => KEY });

    const [a, b] = await Promise.all([drain.runOnce(), drain.runOnce()]);

    // Exactly one of the two did the work; the other short-circuited.
    const total = a.sealed + b.sealed;
    expect(total).toBe(10);
    expect([a.sealed, b.sealed].sort((x, y) => x - y)).toEqual([0, 10]);
    expect(entries.get('tenant-a')).toHaveLength(10);
    expect(seals).toHaveLength(10); // no row sealed twice
    const chain = entries.get('tenant-a')!;
    expect(chain.map((e) => e.chainSeq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(verifyKeyedEntrySequence('tenant-a', chain, resolve).valid).toBe(true);
  });

  it('seals each tenant into its own chain, independently', async () => {
    const { sealer, entries } = createFakeSealer({
      'tenant-a': [queueRow(1, { tenantId: 'tenant-a' }), queueRow(2, { tenantId: 'tenant-a' })],
      'tenant-b': [queueRow(1, { tenantId: 'tenant-b', entityId: 'b1' })],
    });
    const drain = createAuditIngestDrain({ sealer, key: () => KEY });

    const result = await drain.runOnce();

    expect(result.tenants).toBe(2);
    expect(result.sealed).toBe(3);
    expect(entries.get('tenant-a')!.map((e) => e.chainSeq)).toEqual([1, 2]);
    expect(entries.get('tenant-b')!.map((e) => e.chainSeq)).toEqual([1]);
    // Chains do not cross: tenant-b's first row has no prevHash of its own.
    expect(entries.get('tenant-b')![0].prevHash).toBeNull();
  });

  it('a second pass after new rows arrive extends the same tenant chain contiguously', async () => {
    const seed = { 'tenant-a': [queueRow(1), queueRow(2)] };
    const { sealer, entries } = createFakeSealer(seed);
    const drain = createAuditIngestDrain({ sealer, key: () => KEY });

    await drain.runOnce();
    // New rows enqueued after the first drain.
    seed['tenant-a'].push(queueRow(3), queueRow(4));
    const second = await drain.runOnce();

    expect(second.sealed).toBe(2); // only the new rows
    const chain = entries.get('tenant-a')!;
    expect(chain.map((e) => e.chainSeq)).toEqual([1, 2, 3, 4]);
    expect(verifyKeyedEntrySequence('tenant-a', chain, resolve).valid).toBe(true);
  });

  it('one tenant failing does not block the others and is reported', async () => {
    const { sealer, entries } = createFakeSealer({
      'tenant-a': [queueRow(1, { tenantId: 'tenant-a' })],
      'tenant-b': [queueRow(1, { tenantId: 'tenant-b' })],
    });
    const original = sealer.withTenant.bind(sealer);
    sealer.withTenant = (tenantId, fn) => {
      if (tenantId === 'tenant-a') return Promise.reject(new Error('transient conflict'));
      return original(tenantId, fn);
    };
    const drain = createAuditIngestDrain({ sealer, key: () => KEY });

    const result = await drain.runOnce();

    expect(result.failures).toEqual([{ tenantId: 'tenant-a', error: 'transient conflict' }]);
    expect(result.sealed).toBe(1); // tenant-b still sealed
    expect(entries.get('tenant-b')).toHaveLength(1);
  });

  it("start() schedules an unref'd interval and stop() clears it", () => {
    vi.useFakeTimers();
    try {
      const unref = vi.fn();
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
        fn: () => void,
        _ms?: number,
      ) => {
        return { unref } as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);
      const { sealer } = createFakeSealer({});
      const drain = createAuditIngestDrain({ sealer, key: () => KEY, intervalMs: 5000 });

      expect(drain.running).toBe(false);
      drain.start();
      expect(drain.running).toBe(true);
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(unref).toHaveBeenCalledTimes(1); // never keeps the loop alive
      drain.stop();
      expect(drain.running).toBe(false);
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });

  it('runOnce with no pending tenants is a no-op', async () => {
    const { sealer } = createFakeSealer({});
    const drain = createAuditIngestDrain({ sealer, key: () => KEY });
    expect(await drain.runOnce()).toEqual({ tenants: 0, sealed: 0, failures: [] });
  });
});
