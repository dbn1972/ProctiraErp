/**
 * W1-SEC-10 COMPLETE — forced audit/outbox failure must not commit domain state.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PgClient, PgPoolWithConnect, PgQueryable } from '@proctira/database';

import {
  appendAuditEntryOnClient,
  configureAuditChainKey,
  currentAuditChainKey,
  runRegulatedMutationInTxn,
  toCreateAuditLogInput,
} from './txn-mutation-audit.js';
import { computeKeyedEntryHash } from './audit-hash.js';

type Row = Record<string, unknown>;

/**
 * Minimal transactional pool exercising the PRC-M200 SECURITY DEFINER write
 * path: the runtime role no longer touches audit_chain_heads directly, it calls
 * audit_chain_lock_head(tenant) then audit_chain_append(...). This pool rejects
 * any direct DML on audit_chain_heads exactly as migration 294 does, so a
 * regression back to the direct-INSERT path fails here.
 */
function createTxnPool() {
  const durable = {
    domain: new Map<string, Row>(),
    audit: new Map<string, Row>(),
    chain: new Map<string, { head_seq: number; head_hash: string | null }>(),
  };
  let scratch: typeof durable | null = null;
  let inTx = false;

  const runQuery = async (text: string, values: unknown[] = []) => {
    const store = inTx && scratch ? scratch : durable;
    const sql = text.replace(/\s+/g, ' ').trim();

    if (sql === 'BEGIN') {
      inTx = true;
      scratch = {
        domain: new Map(durable.domain),
        audit: new Map(durable.audit),
        chain: new Map(durable.chain),
      };
      return { rows: [] };
    }
    if (sql === 'COMMIT') {
      if (scratch) {
        durable.domain = scratch.domain;
        durable.audit = scratch.audit;
        durable.chain = scratch.chain;
      }
      scratch = null;
      inTx = false;
      return { rows: [] };
    }
    if (sql === 'ROLLBACK') {
      scratch = null;
      inTx = false;
      return { rows: [] };
    }
    if (sql.startsWith('SELECT set_config') || sql.includes('set_config(')) {
      return { rows: [] };
    }

    if (sql.startsWith('INSERT INTO domain_items')) {
      const [id, tenantId, payload] = values as [string, string, string];
      store.domain.set(id, { id, tenant_id: tenantId, payload });
      return { rows: [{ id, tenant_id: tenantId, payload }] };
    }
    if (sql.startsWith('SELECT * FROM domain_items WHERE id')) {
      const row = store.domain.get(String(values[0]));
      return { rows: row ? [row] : [] };
    }

    // PRC-M200: the runtime role must NOT touch audit_chain_heads directly
    // (migration 294 revokes INSERT/UPDATE/DELETE). Reject it like Postgres.
    if (/\b(INSERT INTO|UPDATE|DELETE FROM)\s+audit_chain_heads\b/i.test(sql)) {
      throw new Error(
        `permission denied for table audit_chain_heads (PRC-M200: use audit_chain_append)`,
      );
    }

    // audit_chain_lock_head(tenant) -> (head_seq, head_hash); creates head on first use.
    if (sql.includes('FROM audit_chain_lock_head(')) {
      const tenantId = String(values[0]);
      if (!store.chain.has(tenantId)) store.chain.set(tenantId, { head_seq: 0, head_hash: null });
      return { rows: [store.chain.get(tenantId)!] };
    }

    // audit_chain_append(...) -> (chain_seq, prev_hash); inserts row + advances head.
    if (sql.includes('FROM audit_chain_append(')) {
      const tenantId = String(values[0]);
      const head = store.chain.get(tenantId) ?? { head_seq: 0, head_hash: null };
      const chainSeq = head.head_seq + 1;
      const prevHash = head.head_hash;
      const id = String(values[1]);
      const entryHash = String(values[12]);
      const keyId = String(values[13]);
      store.audit.set(id, {
        id,
        tenant_id: tenantId,
        entity_type: values[2],
        entity_id: values[3],
        operation: values[4],
        user_id: values[5],
        user_name: values[6],
        ip_address: values[7],
        occurred_at: values[8],
        before_values: values[9] == null ? null : JSON.parse(String(values[9])),
        after_values: values[10] == null ? null : JSON.parse(String(values[10])),
        metadata: values[11] == null ? null : JSON.parse(String(values[11])),
        chain_seq: chainSeq,
        prev_hash: prevHash,
        entry_hash: entryHash,
        key_id: keyId,
      });
      store.chain.set(tenantId, { head_seq: chainSeq, head_hash: entryHash });
      return { rows: [{ chain_seq: chainSeq, prev_hash: prevHash }] };
    }

    throw new Error(`unexpected SQL in test pool: ${sql}`);
  };

  const pool: PgPoolWithConnect = {
    query: (text, values) => runQuery(text, values ?? []),
    connect: async (): Promise<PgClient> => ({
      query: (text, values) => runQuery(text, values ?? []),
      release: () => undefined,
    }),
  };

  return {
    pool,
    getDurableDomain: () => durable.domain,
    getDurableAudit: () => durable.audit,
  };
}

describe('W1-SEC-10 COMPLETE txn mutation audit', () => {
  it('toCreateAuditLogInput fills id and timestamp', () => {
    const input = toCreateAuditLogInput({
      tenantId: 't1',
      entityType: 'health_record',
      entityId: 'e1',
      operation: 'CREATE',
      userId: 'u1',
      userName: 'User',
      ipAddress: '127.0.0.1',
      afterValues: { ok: true },
    });
    expect(input.id).toBeTruthy();
    expect(input.timestamp).toBeInstanceOf(Date);
    expect(input.beforeValues).toBeNull();
  });

  it('commits domain + audit together on success', async () => {
    const { pool, getDurableDomain, getDurableAudit } = createTxnPool();
    const { result, audit } = await runRegulatedMutationInTxn({
      pool,
      tenantId: 'tenant-a',
      audit: {
        tenantId: 'tenant-a',
        entityType: 'health_record',
        entityId: 'meas-1',
        operation: 'CREATE',
        userId: 'u1',
        userName: 'Nurse',
        ipAddress: '10.0.0.1',
        afterValues: { path: '/api/v1/health/measurements' },
      },
      mutate: async (client) => {
        const res = await client.query(
          `INSERT INTO domain_items (id, tenant_id, payload) VALUES ($1,$2,$3) RETURNING *`,
          ['meas-1', 'tenant-a', 'phi'],
        );
        return res.rows[0];
      },
    });
    expect(result).toMatchObject({ id: 'meas-1' });
    expect(audit.entityId).toBe('meas-1');
    expect(getDurableDomain().has('meas-1')).toBe(true);
    expect(getDurableAudit().size).toBe(1);
  });

  it('rolls back domain when audit insert fails', async () => {
    const { pool, getDurableDomain, getDurableAudit } = createTxnPool();
    const failingPool: PgPoolWithConnect = {
      query: pool.query.bind(pool),
      connect: async () => {
        const client = await pool.connect();
        const original = client.query.bind(client);
        return {
          release: client.release.bind(client),
          query: async (text: string, values?: unknown[]) => {
            if (text.includes('audit_chain_append(')) {
              throw new Error('forced audit failure');
            }
            return original(text, values);
          },
        };
      },
    };

    await expect(
      runRegulatedMutationInTxn({
        pool: failingPool,
        tenantId: 'tenant-a',
        audit: {
          tenantId: 'tenant-a',
          entityType: 'health_record',
          entityId: 'meas-fail',
          operation: 'CREATE',
          userId: 'u1',
          userName: 'Nurse',
          ipAddress: '10.0.0.1',
          afterValues: { path: '/api/v1/health/measurements' },
        },
        mutate: async (client) => {
          await client.query(
            `INSERT INTO domain_items (id, tenant_id, payload) VALUES ($1,$2,$3) RETURNING *`,
            ['meas-fail', 'tenant-a', 'phi'],
          );
          return { id: 'meas-fail' };
        },
      }),
    ).rejects.toThrow(/forced audit failure/);

    expect(getDurableDomain().has('meas-fail')).toBe(false);
    expect(getDurableAudit().size).toBe(0);
  });

  it('rolls back domain + audit when outbox enqueue fails', async () => {
    const { pool, getDurableDomain, getDurableAudit } = createTxnPool();
    await expect(
      runRegulatedMutationInTxn({
        pool,
        tenantId: 'tenant-a',
        audit: {
          tenantId: 'tenant-a',
          entityType: 'scholarship',
          entityId: 'pay-1',
          operation: 'CREATE',
          userId: 'u1',
          userName: 'Cashier',
          ipAddress: '10.0.0.2',
          afterValues: { path: '/api/v1/fees/payments' },
        },
        mutate: async (client) => {
          await client.query(
            `INSERT INTO domain_items (id, tenant_id, payload) VALUES ($1,$2,$3) RETURNING *`,
            ['pay-1', 'tenant-a', 'money'],
          );
          return { id: 'pay-1' };
        },
        outbox: {
          store: {
            enqueue: async () => {
              throw new Error('forced outbox failure');
            },
          },
          entry: { id: 'ob-1' },
        },
      }),
    ).rejects.toThrow(/forced outbox failure/);

    expect(getDurableDomain().has('pay-1')).toBe(false);
    expect(getDurableAudit().size).toBe(0);
  });

  it('appendAuditEntryOnClient advances the chain via the definer functions (no direct head DML)', async () => {
    configureAuditChainKey(null); // dev fallback key
    const calls: string[] = [];
    const client: PgQueryable = {
      query: vi.fn(async (text: string, _values?: unknown[]) => {
        const sql = String(text).replace(/\s+/g, ' ').trim();
        calls.push(sql);
        if (sql.includes('audit_chain_lock_head(')) {
          return { rows: [{ head_seq: 0, head_hash: null }] };
        }
        if (sql.includes('audit_chain_append(')) {
          return { rows: [{ chain_seq: 1, prev_hash: null }] };
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    };
    const input = toCreateAuditLogInput({
      tenantId: 't1',
      entityType: 'health_record',
      entityId: 'e1',
      operation: 'CREATE',
      userId: 'u1',
      userName: 'u1',
      ipAddress: '127.0.0.1',
      afterValues: { ok: 1 },
    });
    const entry = await appendAuditEntryOnClient(client, input);

    // Exactly the two definer calls — no direct audit_chain_heads DML.
    expect(calls.some((s) => s.includes('audit_chain_lock_head('))).toBe(true);
    expect(calls.some((s) => s.includes('audit_chain_append('))).toBe(true);
    expect(
      calls.some((s) => /\b(INSERT INTO|UPDATE|DELETE FROM)\s+audit_chain_heads\b/i.test(s)),
    ).toBe(false);
    // The row is keyed (HMAC under the configured key id), not the legacy sha256.
    expect(entry.keyId).toBe(currentAuditChainKey().keyId);
    expect(entry.chainSeq).toBe(1);
    expect(entry.prevHash).toBeNull();
    const expectedHmac = computeKeyedEntryHash(input, null, currentAuditChainKey());
    expect(entry.entryHash).toBe(expectedHmac);
  });
});
