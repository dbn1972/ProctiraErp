/**
 * Category 1 — Unit Tests: tenant scoping in every query.
 *
 * PRC-M614: drives the product tenant binders from `@proctira/database`
 * (`withPgTenant` for raw node-pg repositories, `withTenantTransaction` for
 * Prisma) over recording doubles. It verifies that every query a repository
 * runs is on a connection whose transaction-local `app.tenant_id` is the caller
 * tenant, that concurrent tenants never share a bound connection, and that a
 * missing tenant fails before any query. Row filtering itself is Postgres RLS,
 * proved live in src/integration/rls-live.test.ts.
 *
 * Charter: Section 39 (Tenant Isolation Verification)
 * Validates: Requirements 4.7, 23.2 (tenant_id enforcement)
 */
import {
  BIND_TENANT_GUC_SQL,
  withPgTenant,
  withTenantTransaction,
  type PrismaClient,
} from '@proctira/database';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { distinctTenantPairArb, uuidV4Arb } from '../helpers/index.js';

interface Statement {
  client: number;
  text: string;
  values?: unknown[];
}

/** Records every statement per checked-out client, like a pg.Pool would run them. */
class RecordingPool {
  readonly statements: Statement[] = [];
  released = 0;
  private next = 0;
  async connect() {
    const client = ++this.next;
    return {
      query: async (text: string, values?: unknown[]) => {
        this.statements.push({ client, text, values });
        // Yield so concurrent transactions interleave like real I/O.
        await new Promise((resolve) => setImmediate(resolve));
        return { rows: [] };
      },
      release: () => {
        this.released += 1;
      },
    };
  }
  async query(): Promise<never> {
    throw new Error('pooled query outside a tenant transaction');
  }
  /** The tenant each client was bound to (from the bind statement). */
  boundTenant(client: number): unknown {
    return this.statements.find((s) => s.client === client && s.text === BIND_TENANT_GUC_SQL)
      ?.values?.[0];
  }
}

describe('Category 1 — Unit Tests: Tenant Scoping in Every Query (product binders)', () => {
  it('every repository query runs after BEGIN + bind of the caller tenant, then COMMIT', async () => {
    await fc.assert(
      fc.asyncProperty(uuidV4Arb, async (tenantId) => {
        const pool = new RecordingPool();
        await withPgTenant(pool, tenantId, async (client) => {
          await client.query('SELECT * FROM students WHERE id = $1', ['s-1']);
          await client.query('UPDATE students SET name = $2 WHERE id = $1', ['s-1', 'x']);
        });
        expect(pool.statements.map((s) => s.text)).toEqual([
          'BEGIN',
          BIND_TENANT_GUC_SQL,
          'SELECT * FROM students WHERE id = $1',
          'UPDATE students SET name = $2 WHERE id = $1',
          'COMMIT',
        ]);
        expect(new Set(pool.statements.map((s) => s.client)).size).toBe(1);
        expect(pool.boundTenant(1)).toBe(tenantId.toLowerCase());
        expect(pool.released).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it('the bind is transaction-local and parameterised (never interpolated)', () => {
    expect(BIND_TENANT_GUC_SQL).toContain("set_config('app.tenant_id', $1, true)");
    expect(BIND_TENANT_GUC_SQL).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('concurrent tenants never share a bound connection', async () => {
    await fc.assert(
      fc.asyncProperty(distinctTenantPairArb, async ({ tenantA, tenantB }) => {
        const pool = new RecordingPool();
        await Promise.all(
          [tenantA, tenantB, tenantA, tenantB].map((tenantId, i) =>
            withPgTenant(pool, tenantId, async (client) => {
              await client.query(`SELECT ${i}`);
              await client.query(`SELECT ${i} AS again`);
            }),
          ),
        );
        const selects = pool.statements.filter((s) => /^SELECT \d/.test(s.text));
        expect(selects).toHaveLength(8);
        for (const statement of selects) {
          const index = Number(statement.text.split(' ')[1]);
          const expected = (index % 2 === 0 ? tenantA : tenantB).toLowerCase();
          expect(pool.boundTenant(statement.client)).toBe(expected);
        }
      }),
      { numRuns: 50 },
    );
  });

  it('queries without a tenant fail before any statement or connection', async () => {
    for (const tenantId of ['', '   ']) {
      const pool = new RecordingPool();
      let ran = false;
      await expect(
        withPgTenant(pool, tenantId, async () => {
          ran = true;
        }),
      ).rejects.toThrow(/invalid tenantId/);
      expect(ran).toBe(false);
      expect(pool.statements).toEqual([]);
    }
  });

  it('a failing query rolls back and releases the connection', async () => {
    const pool = new RecordingPool();
    await expect(
      withPgTenant(pool, '00000000-0000-4000-8000-0000000000a1', async (client) => {
        await client.query('INSERT INTO students VALUES ($1)', ['x']);
        throw new Error('constraint');
      }),
    ).rejects.toThrow('constraint');
    expect(pool.statements.map((s) => s.text).slice(-1)).toEqual(['ROLLBACK']);
    expect(pool.statements.some((s) => s.text === 'COMMIT')).toBe(false);
    expect(pool.released).toBe(1);
  });

  it('Prisma transactions bind the caller tenant first and refuse a non-UUID tenant', async () => {
    await fc.assert(
      fc.asyncProperty(uuidV4Arb, async (tenantId) => {
        const calls: Array<{ sql: string; values: unknown[] }> = [];
        const tx = {
          $executeRawUnsafe: async (sql: string, ...values: unknown[]) => {
            calls.push({ sql, values });
            return 1;
          },
        };
        const prisma = {
          $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
        } as unknown as PrismaClient;
        await withTenantTransaction(prisma, tenantId, async (client) => {
          await (client as unknown as typeof tx).$executeRawUnsafe('SELECT 1');
        });
        expect(calls[0]).toEqual({ sql: BIND_TENANT_GUC_SQL, values: [tenantId.toLowerCase()] });
        expect(calls[1]?.sql).toBe('SELECT 1');
      }),
      { numRuns: 50 },
    );
    const prisma = {
      $transaction: async () => {
        throw new Error('must not open a transaction');
      },
    } as unknown as PrismaClient;
    await expect(withTenantTransaction(prisma, 'tenant-a', async () => 1)).rejects.toThrow(
      /expected UUID/,
    );
  });
});
