/**
 * PRC-L091 — live Postgres proof that RLS-only queries can use tenant_id
 * btree indexes after db/sql/308.
 *
 * Before 308 the policies compare `(tenant_id)::text = NULLIF(current_setting(
 * 'app.tenant_id', true), '')`, which the planner cannot use as an index
 * condition on the uuid column: even with enable_seqscan off the predicate stays a
 * filter, never an index condition. After 308 they compare `tenant_id =
 * app_tenant_uuid()`, and the same query gets `Index Cond: (tenant_id = ...)`
 * on a tenant_id-leading index.
 *
 * The helper must keep the safe-deny rule (PRC-L294): a malformed, uppercase,
 * empty or missing GUC returns NULL (deny), never raises.
 *
 * Requires DATABASE_URL as proctira_app. MIGRATOR_DATABASE_URL (table owner)
 * is used for the red phase, which puts the pre-308 policy back on the probe
 * tables and then re-applies 308; without it the red phase is skipped.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'rls-tenant-uuid-sargable.live.test' });
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL'];

const MIGRATION_308 = '308_rls_tenant_uuid_sargable.sql';
const TEXT_TERM = `NULLIF(current_setting('app.tenant_id', true), '')`;

/** Hot tables without a platform_admin OR branch (the OR defeats any index). */
const PROBES = [
  {
    table: 'grade_entries',
    policy: 'tenant_isolation',
    pre308: `ALTER POLICY tenant_isolation ON grade_entries
      USING (tenant_id::text = ${TEXT_TERM}) WITH CHECK (tenant_id::text = ${TEXT_TERM})`,
  },
  {
    table: 'student_attendance',
    policy: 'tenant_isolation_select',
    pre308: `ALTER POLICY tenant_isolation_select ON student_attendance
      USING (tenant_id::text = ${TEXT_TERM})`,
  },
] as const;

function load308(): string {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  return readFileSync(path.join(root, 'db/sql', MIGRATION_308), 'utf8');
}

interface PlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Recheck Cond'?: string;
  Plans?: PlanNode[];
}

function scanNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(scanNodes)];
}

/** A node whose index condition is the tenant predicate (not a full-index filter scan). */
function tenantIndexCondNode(nodes: PlanNode[]): PlanNode | undefined {
  return nodes.find((n) => /\btenant_id\s*=/.test(n['Index Cond'] ?? ''));
}

describe.skipIf(!DATABASE_URL)('PRC-L091 RLS tenant predicate is index-friendly (live)', () => {
  let pool: pg.Pool;
  let migrator: pg.Pool | undefined;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    if (MIGRATOR_DATABASE_URL) {
      migrator = new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL });
    }
  });

  afterAll(async () => {
    await pool.end();
    await migrator?.end();
  });

  async function rlsOnlyPlan(table: string): Promise<PlanNode[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [randomUUID()]);
      // Not a tuning setting: it makes the planner show whether ANY index path
      // exists for the RLS predicate (a no tenant_id Index Cond here means none does).
      await client.query('SET LOCAL enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': [{ Plan: PlanNode }] }>(
        `EXPLAIN (FORMAT JSON) SELECT id FROM ${table}`,
      );
      await client.query('ROLLBACK');
      return scanNodes(rows[0]!['QUERY PLAN'][0].Plan);
    } finally {
      // A failed assertion inside BEGIN must not return an aborted client to the pool.
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  it.skipIf(!MIGRATOR_DATABASE_URL)(
    'RED: the pre-308 text compare cannot use tenant_id as an index condition',
    async () => {
      const m = migrator!;
      try {
        for (const probe of PROBES) await m.query(probe.pre308);
        for (const probe of PROBES) {
          // With seq scans off the planner may still walk a whole index, but
          // the tenant predicate can only be a Filter, never an Index Cond.
          const nodes = await rlsOnlyPlan(probe.table);
          expect(
            tenantIndexCondNode(nodes),
            `${probe.table}: text compare must not be an index condition`,
          ).toBeUndefined();
        }
      } finally {
        await m.query(load308());
      }
    },
  );

  it('GREEN: an RLS-only query uses a tenant_id-leading index', async () => {
    if (migrator) await migrator.query(load308());
    for (const probe of PROBES) {
      const nodes = await rlsOnlyPlan(probe.table);
      const index = tenantIndexCondNode(nodes)?.['Index Name'];
      expect(index, `${probe.table}: expected Index Cond (tenant_id = ...)`).toBeTruthy();
      const { rows } = await pool.query<{ def: string }>(
        `SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
        [index],
      );
      expect(rows[0]!.def).toMatch(/USING btree \(tenant_id\b/);
    }
  });

  it('GREEN: probe policies now compare tenant_id = app_tenant_uuid() with FORCE kept', async () => {
    for (const probe of PROBES) {
      const { rows } = await pool.query<{
        qual: string | null;
        forced: boolean;
        enabled: boolean;
      }>(
        `SELECT p.qual, c.relforcerowsecurity AS forced, c.relrowsecurity AS enabled
           FROM pg_policies p
           JOIN pg_class c ON c.relname = p.tablename
           JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
          WHERE p.schemaname = 'public' AND p.tablename = $1 AND p.policyname = $2`,
        [probe.table, probe.policy],
      );
      expect(rows[0]!.qual).toBe('(tenant_id = app_tenant_uuid())');
      expect(rows[0]!.enabled).toBe(true);
      expect(rows[0]!.forced).toBe(true);
    }
  });

  it('app_tenant_uuid() returns the bound tenant and NULL (never raises) otherwise', async () => {
    const tenant = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const value = async (guc: string | null): Promise<string | null> => {
        if (guc !== null) await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [guc]);
        const { rows } = await client.query<{ v: string | null }>(
          'SELECT app_tenant_uuid()::text AS v',
        );
        return rows[0]!.v;
      };
      expect(await value(null)).toBeNull();
      expect(await value(tenant)).toBe(tenant);
      for (const bad of ['', 'not-a-uuid', tenant.toUpperCase(), tenant.replace(/-/g, ''), ' ']) {
        expect(await value(bad), JSON.stringify(bad)).toBeNull();
      }
      await client.query('ROLLBACK');
    } finally {
      // A failed assertion inside BEGIN must not return an aborted client to the pool.
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('isolates tenants and denies a malformed GUC on a rewritten table', async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
      for (const id of [tenantA, tenantB]) {
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [id]);
        await client.query(
          `INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $2, 'active')`,
          [id, `l091-${id.slice(0, 8)}`],
        );
      }
      await client.query(`SELECT set_config('app.platform_admin', '', true)`);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
      await client.query(
        `INSERT INTO notification_preferences (tenant_id, user_id) VALUES ($1, 'l091-user')`,
        [tenantA],
      );
      // WITH CHECK: tenant A cannot write a tenant B row.
      await client.query('SAVEPOINT cross_tenant');
      await expect(
        client.query(
          `INSERT INTO notification_preferences (tenant_id, user_id) VALUES ($1, 'l091-user')`,
          [tenantB],
        ),
      ).rejects.toThrow(/row-level security/i);
      await client.query('ROLLBACK TO SAVEPOINT cross_tenant');

      const count = async (): Promise<number> => {
        const { rows } = await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM notification_preferences WHERE user_id = 'l091-user'`,
        );
        return Number(rows[0]!.n);
      };
      expect(await count()).toBe(1);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB]);
      expect(await count()).toBe(0);
      await client.query(`SELECT set_config('app.tenant_id', 'not-a-uuid', true)`);
      expect(await count()).toBe(0);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA.toUpperCase()]);
      expect(await count()).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      // A failed assertion inside BEGIN must not return an aborted client to the pool.
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });
});
