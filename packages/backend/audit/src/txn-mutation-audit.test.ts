/**
 * W1-SEC-10 COMPLETE — forced audit/outbox failure must not commit domain state.
 */
import { describe, expect, it, vi } from 'vitest';

import type { PgClient, PgPoolWithConnect, PgQueryable } from '@proctira/database';

import {
  appendAuditEntryOnClient,
  runRegulatedMutationInTxn,
  toCreateAuditLogInput,
} from './txn-mutation-audit.js';

type Row = Record<string, unknown>;

/**
 * Minimal transactional pool: domain rows live in `domain`, audit in `audit`.
 * COMMIT only persists scratch → durable; ROLLBACK discards scratch.
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
    if (sql.startsWith('INSERT INTO audit_chain_heads')) {
      const tenantId = String(values[0]);
      if (!store.chain.has(tenantId)) {
        store.chain.set(tenantId, { head_seq: 0, head_hash: null });
      }
      return { rows: [] };
    }
    if (sql.includes('FROM audit_chain_heads') && sql.includes('FOR UPDATE')) {
      const tenantId = String(values[0]);
      const head = store.chain.get(tenantId) ?? { head_seq: 0, head_hash: null };
      return { rows: [head] };
    }
    if (sql.startsWith('INSERT INTO audit_log_entries')) {
      const id = String(values[0]);
      const row: Row = {
        id,
        tenant_id: values[1],
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
        chain_seq: values[12],
        prev_hash: values[13],
        entry_hash: values[14],
      };
      store.audit.set(id, row);
      return { rows: [row] };
    }
    if (sql.startsWith('UPDATE audit_chain_heads')) {
      store.chain.set(String(values[0]), {
        head_seq: Number(values[1]),
        head_hash: values[2] == null ? null : String(values[2]),
      });
      return { rows: [] };
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
            if (text.includes('INSERT INTO audit_log_entries')) {
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

  it('appendAuditEntryOnClient writes chain-linked row on a bare client', async () => {
    const client: PgQueryable = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [] }) // chain head insert
        .mockResolvedValueOnce({ rows: [{ head_seq: 0, head_hash: null }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'a1',
              tenant_id: 't1',
              entity_type: 'health_record',
              entity_id: 'e1',
              operation: 'CREATE',
              user_id: 'u1',
              user_name: 'u1',
              ip_address: '127.0.0.1',
              occurred_at: new Date(),
              before_values: null,
              after_values: { ok: 1 },
              metadata: null,
              chain_seq: 1,
              prev_hash: null,
              entry_hash: 'abc',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }), // chain head update
    };
    const entry = await appendAuditEntryOnClient(
      client,
      toCreateAuditLogInput({
        tenantId: 't1',
        entityType: 'health_record',
        entityId: 'e1',
        operation: 'CREATE',
        userId: 'u1',
        userName: 'u1',
        ipAddress: '127.0.0.1',
        afterValues: { ok: 1 },
      }),
    );
    expect(entry.id).toBe('a1');
    expect(entry.chainSeq).toBe(1);
  });
});
