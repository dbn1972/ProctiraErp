/**
 * H-D3 — live proof that hostel child rows can only reference parents in their
 * own tenant (service layer + db/sql/303 and 304).
 *
 * Runs as the runtime role (DATABASE_URL = proctira_app, NOSUPERUSER
 * NOBYPASSRLS); the migration cases use MIGRATOR_DATABASE_URL (table owner)
 * inside transactions that are always rolled back.
 *
 * Before the fix (RED, origin/main): tenant A's POST /hostel/visitors, /blocks
 * and /leaves with tenant B's hostelId, /rooms with B's blockId and /beds with
 * B's roomId return 201, and a random id returns a 500 naming the FK (an
 * existence oracle). A write with B's studentId returns a 500 naming
 * `_student_id_tenant_fk`, a random studentId one naming `_student_id_fkey`. A
 * direct INSERT under tenant A with B's parent id succeeds, and deleting B's
 * hostel cascades into A's rows. 303/304 are absent.
 * After (GREEN): 404 NOT_FOUND with identical bodies for another tenant's id
 * and a random id; same-tenant writes keep their status; the DB rejects every
 * cross-tenant parent reference on `<child>_<col>_tenant_fk` even with the
 * service bypassed; the cascade cannot reach another tenant; 304 is
 * idempotent, fails closed on a violating row and refuses unbounded timeouts.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostelPlugin } from './hostel-plugin.js';
import { PgHostelRepository } from './pg-hostel-repository.js';

const DATABASE_URL = process.env['DATABASE_URL'] ?? '';
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL'] ?? '';
if (
  (!DATABASE_URL || !MIGRATOR_DATABASE_URL) &&
  (process.env['CI'] === 'true' || process.env['REQUIRE_LIVE_TESTS'] === '1')
) {
  throw new Error(
    'hostel-tenant-parent-fks.live.test requires DATABASE_URL and MIGRATOR_DATABASE_URL (no silent skip)',
  );
}

const MIGRATION_304 = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
  'db/sql/304_hostel_tenant_parent_fks.sql',
);

const HOSTEL_TABLES = [
  'hostels',
  'hostel_blocks',
  'hostel_rooms',
  'hostel_beds',
  'mess_plans',
  'hostel_assignments',
  'hostel_leaves',
  'hostel_visitors',
  'mess_menu_items',
  'mess_subscriptions',
  'gate_passes',
  'hostel_fee_structures',
  'hostel_attendance',
];

type Tree = {
  hostelId: string;
  blockId: string;
  roomId: string;
  bedId: string;
  planId: string;
};

type Res = { statusCode: number; body: string; json: () => Record<string, unknown> };

/** Same body once the probed id is replaced (no existence oracle). */
function normalized(res: Res, id: string): string {
  return res.body.replaceAll(id, '<id>');
}

describe.skipIf(!DATABASE_URL || !MIGRATOR_DATABASE_URL)(
  'H-D3 hostel tenant-parent integrity (live Postgres)',
  () => {
    let pool: pg.Pool;
    let migrator: pg.Pool;
    let app: FastifyInstance;
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const studentA = randomUUID();
    const studentAssign = randomUUID();
    const studentB = randomUUID();
    let treeA: Tree;
    let treeB: Tree;

    async function call(
      tenantId: string,
      method: 'POST' | 'PUT',
      url: string,
      payload: Record<string, unknown>,
    ): Promise<Res> {
      const res = await app.inject({
        method,
        url,
        payload,
        headers: { 'x-test-tenant': tenantId },
      });
      return { statusCode: res.statusCode, body: res.body, json: () => res.json() };
    }

    async function created(tenantId: string, url: string, payload: Record<string, unknown>) {
      const res = await call(tenantId, 'POST', url, payload);
      expect(res.statusCode, `${url} fixture: ${res.body}`).toBe(201);
      return res.json()['id'] as string;
    }

    async function buildTree(tenantId: string, label: string): Promise<Tree> {
      const suffix = randomUUID().slice(0, 8);
      const hostelId = await created(tenantId, '/hostel', {
        name: `${label} Hall`,
        code: `${label}-${suffix}`,
        capacity: 20,
      });
      const blockId = await created(tenantId, '/hostel/blocks', { hostelId, name: `${label}-B` });
      const roomId = await created(tenantId, '/hostel/rooms', {
        blockId,
        roomNumber: `${label}-101`,
        capacity: 4,
      });
      const bedId = await created(tenantId, '/hostel/beds', { roomId, bedLabel: `${label}-1` });
      const planId = await created(tenantId, '/hostel/mess/plans', {
        hostelId,
        name: `${label} plan`,
      });
      return { hostelId, blockId, roomId, bedId, planId };
    }

    async function freshBedA(): Promise<string> {
      return created(tenantA, '/hostel/beds', {
        roomId: treeA.roomId,
        bedLabel: `b-${randomUUID().slice(0, 8)}`,
      });
    }

    async function countTenantRows(tenantId: string): Promise<number> {
      return withPgTenant(pool, tenantId, async (client) => {
        let total = 0;
        for (const table of HOSTEL_TABLES) {
          const r = (await client.query(
            `SELECT count(*)::int AS n FROM public.${table} WHERE tenant_id = $1`,
            [tenantId],
          )) as unknown as pg.QueryResult<{ n: number }>;
          total += r.rows[0]!.n;
        }
        return total;
      });
    }

    async function inMigratorTx(fn: (client: pg.PoolClient) => Promise<void>): Promise<void> {
      const client = await migrator.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL lock_timeout = '5s'`);
        await client.query(`SET LOCAL statement_timeout = '5min'`);
        await fn(client);
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
        client.release();
      }
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      migrator = new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL });
      await ensurePgTestTenant(pool, tenantA);
      await ensurePgTestTenant(pool, tenantB);
      await ensurePgTestStudent(pool, tenantA, studentA);
      await ensurePgTestStudent(pool, tenantA, studentAssign);
      await ensurePgTestStudent(pool, tenantB, studentB);

      app = Fastify({ logger: false });
      app.decorateRequest('tenantId', '');
      app.addHook('onRequest', async (request) => {
        const r = request as { tenantId?: string; user?: { sub: string; roles: string[] } };
        r.tenantId = String(request.headers['x-test-tenant'] ?? '');
        r.user = { sub: 'h-d3-live', roles: ['admin'] };
      });
      await app.register(hostelPlugin, {
        repository: new PgHostelRepository(pool),
        prefix: '/hostel',
      });
      await app.ready();

      treeA = await buildTree(tenantA, 'HD3A');
      treeB = await buildTree(tenantB, 'HD3B');
    });

    afterAll(async () => {
      await app?.close();
      await pool?.end();
      await migrator?.end();
    });

    describe('service: parent ids resolve inside the caller tenant', () => {
      const cases: {
        url: string;
        parent: 'hostelId' | 'blockId' | 'roomId';
        label: string;
        body: (id: string) => Record<string, unknown>;
      }[] = [
        {
          url: '/hostel/visitors',
          parent: 'hostelId',
          label: 'Hostel',
          body: (hostelId) => ({
            hostelId,
            visitorName: 'H-D3 visitor',
            studentId: studentA,
            visitDate: '2026-11-20',
          }),
        },
        {
          url: '/hostel/blocks',
          parent: 'hostelId',
          label: 'Hostel',
          body: (hostelId) => ({ hostelId, name: `blk-${randomUUID().slice(0, 8)}` }),
        },
        {
          url: '/hostel/leaves',
          parent: 'hostelId',
          label: 'Hostel',
          body: (hostelId) => ({
            hostelId,
            studentId: studentA,
            startDate: '2026-11-20',
            endDate: '2026-11-22',
          }),
        },
        {
          url: '/hostel/rooms',
          parent: 'blockId',
          label: 'Block',
          body: (blockId) => ({ blockId, roomNumber: `r-${randomUUID().slice(0, 8)}` }),
        },
        {
          url: '/hostel/beds',
          parent: 'roomId',
          label: 'Room',
          body: (roomId) => ({ roomId, bedLabel: `b-${randomUUID().slice(0, 8)}` }),
        },
      ];

      for (const c of cases) {
        it(`POST ${c.url}: own ${c.parent} 201; other tenant's and random 404, identical`, async () => {
          const own = await call(tenantA, 'POST', c.url, c.body(treeA[c.parent]));
          expect(own.statusCode, own.body).toBe(201);

          const foreignId = treeB[c.parent];
          const foreign = await call(tenantA, 'POST', c.url, c.body(foreignId));
          expect(foreign.statusCode, foreign.body).toBe(404);
          expect(foreign.json()).toEqual({
            code: 'NOT_FOUND',
            statusCode: 404,
            message: `${c.label} with id '${foreignId}' not found`,
          });

          const randomId = randomUUID();
          const random = await call(tenantA, 'POST', c.url, c.body(randomId));
          expect(random.statusCode, random.body).toBe(404);
          expect(normalized(foreign, foreignId)).toBe(normalized(random, randomId));
        });
      }
    });

    describe('service: student ids answer the same 404 for another tenant and a random id', () => {
      const cases: {
        name: string;
        method: 'POST' | 'PUT';
        url: string;
        ownStatus: number;
        ownStudent?: () => string;
        body: (studentId: string) => Promise<Record<string, unknown>>;
      }[] = [
        {
          name: 'leave',
          method: 'POST',
          url: '/hostel/leaves',
          ownStatus: 201,
          body: async (studentId) => ({
            hostelId: treeA.hostelId,
            studentId,
            startDate: '2026-11-20',
            endDate: '2026-11-21',
          }),
        },
        {
          name: 'visitor',
          method: 'POST',
          url: '/hostel/visitors',
          ownStatus: 201,
          body: async (studentId) => ({
            hostelId: treeA.hostelId,
            visitorName: 'H-D3 visitor',
            studentId,
            visitDate: '2026-11-20',
          }),
        },
        {
          name: 'gate pass',
          method: 'POST',
          url: '/hostel/gate-passes',
          ownStatus: 201,
          body: async (studentId) => ({
            hostelId: treeA.hostelId,
            studentId,
            expectedOutAt: '2026-11-20T09:00:00Z',
            expectedInAt: '2026-11-20T18:00:00Z',
          }),
        },
        {
          name: 'mess subscription',
          method: 'POST',
          url: '/hostel/mess/subscriptions',
          ownStatus: 201,
          body: async (studentId) => ({
            planId: treeA.planId,
            studentId,
            startDate: '2026-11-20',
          }),
        },
        {
          name: 'attendance',
          method: 'PUT',
          url: '/hostel/attendance',
          ownStatus: 200,
          body: async (studentId) => ({
            blockId: treeA.blockId,
            studentId,
            onDate: '2026-11-20',
            status: 'present',
          }),
        },
        {
          name: 'assignment',
          method: 'POST',
          url: '/hostel/assignments',
          ownStatus: 201,
          ownStudent: () => studentAssign,
          body: async (studentId) => ({
            studentId,
            bedId: await freshBedA(),
            startDate: '2026-11-20',
            isActive: true,
          }),
        },
      ];

      for (const c of cases) {
        it(`${c.method} ${c.url} (${c.name}): own student ${c.ownStatus}; other tenant's and random 404, identical`, async () => {
          const ownId = c.ownStudent ? c.ownStudent() : studentA;
          const own = await call(tenantA, c.method, c.url, await c.body(ownId));
          expect(own.statusCode, own.body).toBe(c.ownStatus);

          const foreign = await call(tenantA, c.method, c.url, await c.body(studentB));
          expect(foreign.statusCode, foreign.body).toBe(404);
          expect(foreign.json()).toEqual({
            code: 'NOT_FOUND',
            statusCode: 404,
            message: `Student with id '${studentB}' not found`,
          });

          const randomId = randomUUID();
          const random = await call(tenantA, c.method, c.url, await c.body(randomId));
          expect(random.statusCode, random.body).toBe(404);
          expect(normalized(foreign, studentB)).toBe(normalized(random, randomId));
        });
      }
    });

    describe('database: composite FKs reject cross-tenant parents with the service bypassed', () => {
      // $1 id, $2 tenant, $3 parent id, $4 tenant-A student
      const edges: { child: string; col: string; parent: keyof Tree; sql: string }[] = [
        {
          child: 'hostel_blocks',
          col: 'hostel_id',
          parent: 'hostelId',
          sql: `INSERT INTO hostel_blocks (id, tenant_id, hostel_id, name) VALUES ($1, $2, $3, 'db-case')`,
        },
        {
          child: 'hostel_rooms',
          col: 'block_id',
          parent: 'blockId',
          sql: `INSERT INTO hostel_rooms (id, tenant_id, block_id, room_number) VALUES ($1, $2, $3, left(md5(random()::text), 12))`,
        },
        {
          child: 'hostel_beds',
          col: 'room_id',
          parent: 'roomId',
          sql: `INSERT INTO hostel_beds (id, tenant_id, room_id, bed_label) VALUES ($1, $2, $3, left(md5(random()::text), 12))`,
        },
        {
          child: 'hostel_assignments',
          col: 'bed_id',
          parent: 'bedId',
          sql: `INSERT INTO hostel_assignments (id, tenant_id, student_id, bed_id, start_date, is_active)
                VALUES ($1, $2, $4, $3, DATE '2026-11-20', false)`,
        },
        {
          child: 'hostel_leaves',
          col: 'hostel_id',
          parent: 'hostelId',
          sql: `INSERT INTO hostel_leaves (id, tenant_id, student_id, hostel_id, start_date, end_date)
                VALUES ($1, $2, $4, $3, DATE '2026-11-20', DATE '2026-11-21')`,
        },
        {
          child: 'hostel_visitors',
          col: 'hostel_id',
          parent: 'hostelId',
          sql: `INSERT INTO hostel_visitors (id, tenant_id, hostel_id, visitor_name, student_id, visit_date)
                VALUES ($1, $2, $3, 'db-case', $4, DATE '2026-11-20')`,
        },
        {
          child: 'mess_plans',
          col: 'hostel_id',
          parent: 'hostelId',
          sql: `INSERT INTO mess_plans (id, tenant_id, hostel_id, name) VALUES ($1, $2, $3, 'db-case')`,
        },
        {
          child: 'mess_menu_items',
          col: 'plan_id',
          parent: 'planId',
          sql: `INSERT INTO mess_menu_items (id, tenant_id, plan_id, weekday, meal, item_name)
                VALUES ($1, $2, $3, 1, 'lunch', 'db-case')`,
        },
        {
          child: 'mess_subscriptions',
          col: 'plan_id',
          parent: 'planId',
          sql: `INSERT INTO mess_subscriptions (id, tenant_id, plan_id, student_id, start_date)
                VALUES ($1, $2, $3, $4, DATE '2026-11-20')`,
        },
        {
          child: 'gate_passes',
          col: 'hostel_id',
          parent: 'hostelId',
          sql: `INSERT INTO gate_passes (id, tenant_id, hostel_id, student_id, expected_out_at, expected_in_at)
                VALUES ($1, $2, $3, $4, now(), now() + interval '1 hour')`,
        },
        {
          child: 'hostel_fee_structures',
          col: 'hostel_id',
          parent: 'hostelId',
          sql: `INSERT INTO hostel_fee_structures (id, tenant_id, hostel_id, room_type, term_label, amount_cents)
                VALUES ($1, $2, $3, 'db-case', left(md5(random()::text), 16), 100)`,
        },
        {
          child: 'hostel_attendance',
          col: 'block_id',
          parent: 'blockId',
          sql: `INSERT INTO hostel_attendance (id, tenant_id, block_id, student_id, on_date, status)
                VALUES ($1, $2, $3, $4, DATE '2026-01-01', 'present')`,
        },
      ];

      async function insertAsA(sql: string, parentId: string): Promise<unknown> {
        try {
          // Bind only the placeholders the statement uses ($1..$n).
          const used = Math.max(...[...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
          const params = [randomUUID(), tenantA, parentId, studentA].slice(0, used);
          await withPgTenant(pool, tenantA, (client) => client.query(sql, params));
          return null;
        } catch (error) {
          return error;
        }
      }

      for (const e of edges) {
        it(`${e.child}.${e.col}: own parent accepted, other tenant's parent rejected by ${e.child}_${e.col}_tenant_fk`, async () => {
          expect(await insertAsA(e.sql, treeA[e.parent])).toBeNull();
          const err = await insertAsA(e.sql, treeB[e.parent]);
          expect(err, 'cross-tenant insert must be rejected').not.toBeNull();
          expect(err).toMatchObject({ code: '23503', constraint: `${e.child}_${e.col}_tenant_fk` });
        });
      }

      it("deleting tenant B's hostel cannot cascade into tenant A's rows", async () => {
        const hB2 = await created(tenantB, '/hostel', {
          name: 'HD3B second',
          code: `HD3B2-${randomUUID().slice(0, 8)}`,
          capacity: 5,
        });
        await created(tenantB, '/hostel/blocks', { hostelId: hB2, name: 'B2-block' });
        // A tries to hang a block off B's hostel directly (service bypassed).
        const crossErr = await insertAsA(
          `INSERT INTO hostel_blocks (id, tenant_id, hostel_id, name) VALUES ($1, $2, $3, 'cascade-case')`,
          hB2,
        );
        // Either stored (unfixed schema) or refused by the composite FK; nothing else.
        if (crossErr) expect(crossErr).toMatchObject({ code: '23503' });
        const before = await countTenantRows(tenantA);
        await withPgTenant(pool, tenantB, (client) =>
          client.query(`DELETE FROM hostels WHERE id = $1 AND tenant_id = $2`, [hB2, tenantB]),
        );
        expect(await countTenantRows(tenantA)).toBe(before);
      });
    });

    describe('catalog', () => {
      it('every hostel id-only parent FK has a validated (tenant_id, col) twin with the same ON DELETE', async () => {
        const { rows } = await pool.query<{
          child: string;
          col: string;
          parent: string;
          del: string;
          twin: string | null;
          twin_del: string | null;
          twin_valid: boolean | null;
        }>(
          `SELECT ch.relname::text AS child, a.attname::text AS col, p.relname::text AS parent,
                  c.confdeltype::text AS del, t.conname::text AS twin,
                  t.confdeltype::text AS twin_del, t.convalidated AS twin_valid
             FROM pg_constraint c
             JOIN pg_class ch ON ch.oid = c.conrelid
             JOIN pg_class p ON p.oid = c.confrelid
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
             LEFT JOIN LATERAL (
               SELECT t.conname, t.confdeltype, t.convalidated
                 FROM pg_constraint t
                 JOIN pg_attribute k1 ON k1.attrelid = t.conrelid AND k1.attnum = t.conkey[1]
                 JOIN pg_attribute k2 ON k2.attrelid = t.conrelid AND k2.attnum = t.conkey[2]
                 JOIN pg_attribute f1 ON f1.attrelid = t.confrelid AND f1.attnum = t.confkey[1]
                 JOIN pg_attribute f2 ON f2.attrelid = t.confrelid AND f2.attnum = t.confkey[2]
                WHERE t.contype = 'f' AND t.conrelid = c.conrelid AND t.confrelid = c.confrelid
                  AND array_length(t.conkey, 1) = 2
                  AND k1.attname = 'tenant_id' AND k2.attname = a.attname
                  AND f1.attname = 'tenant_id' AND f2.attname = 'id'
                LIMIT 1
             ) t ON true
            WHERE c.contype = 'f'
              AND array_length(c.conkey, 1) = 1
              AND ch.relnamespace = 'public'::regnamespace
              AND ch.relname = ANY ($1::text[])
              AND p.relname = ANY ($1::text[])
            ORDER BY 1, 2`,
          [HOSTEL_TABLES],
        );
        expect(rows).toHaveLength(12);
        for (const r of rows) {
          expect(r, `${r.child}.${r.col} -> ${r.parent}`).toMatchObject({
            twin: `${r.child}_${r.col}_tenant_fk`,
            twin_del: r.del,
            twin_valid: true,
          });
        }
      });

      it('FORCE ROW LEVEL SECURITY is on for all 13 hostel tables', async () => {
        const { rows } = await pool.query<{ relname: string }>(
          `SELECT relname::text AS relname FROM pg_class
            WHERE relnamespace = 'public'::regnamespace AND relname = ANY ($1::text[])
              AND relforcerowsecurity`,
          [HOSTEL_TABLES],
        );
        expect(rows.map((r) => r.relname).sort()).toEqual([...HOSTEL_TABLES].sort());
      });

      it('303 and 304 are recorded as applied', async () => {
        const { rows } = await pool.query<{ migration_name: string; migration_applied: boolean }>(
          `SELECT migration_name, migration_applied
             FROM public.proctira_runtime_migration_status($1::text[])
            ORDER BY migration_name`,
          [['303_hostel_tenant_parent_uidx.sql', '304_hostel_tenant_parent_fks.sql']],
        );
        expect(rows).toEqual([
          { migration_name: '303_hostel_tenant_parent_uidx.sql', migration_applied: true },
          { migration_name: '304_hostel_tenant_parent_fks.sql', migration_applied: true },
        ]);
      });
    });

    describe('migration 304 (owner, rolled back)', () => {
      async function compositeState(client: pg.PoolClient) {
        const fks = await client.query<{ n: number; valid: number }>(
          `SELECT count(*)::int AS n, count(*) FILTER (WHERE convalidated)::int AS valid
             FROM pg_constraint
            WHERE contype = 'f' AND conname LIKE '%\\_tenant\\_fk'
              AND array_length(conkey, 1) = 2
              AND conrelid::regclass::text = ANY ($1::text[])
              AND confrelid::regclass::text = ANY ($1::text[])`,
          [HOSTEL_TABLES],
        );
        const forced = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_class
            WHERE relnamespace = 'public'::regnamespace AND relname = ANY ($1::text[])
              AND relforcerowsecurity`,
          [HOSTEL_TABLES],
        );
        return { fks: fks.rows[0]!.n, valid: fks.rows[0]!.valid, forced: forced.rows[0]!.n };
      }

      it('re-running 304 is a no-op', async () => {
        const sql = readFileSync(MIGRATION_304, 'utf8');
        await inMigratorTx(async (client) => {
          await client.query(sql);
          expect(await compositeState(client)).toEqual({ fks: 12, valid: 12, forced: 13 });
        });
      });

      it('fails closed on an existing cross-tenant row and changes nothing', async () => {
        const sql = readFileSync(MIGRATION_304, 'utf8');
        let failure: unknown = null;
        await inMigratorTx(async (client) => {
          await client.query(
            `ALTER TABLE public.hostel_blocks DROP CONSTRAINT hostel_blocks_hostel_id_tenant_fk`,
          );
          await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
          await client.query(
            `INSERT INTO hostel_blocks (id, tenant_id, hostel_id, name) VALUES ($1, $2, $3, 'violating')`,
            [randomUUID(), tenantA, treeB.hostelId],
          );
          await client.query(`SELECT set_config('app.tenant_id', '', true)`);
          failure = await client.query(sql).then(
            () => null,
            (error: unknown) => error,
          );
        });
        expect(failure, '304 must refuse to run over a violating row').not.toBeNull();
        expect(String((failure as Error).message)).toMatch(
          /H-D3: cross-tenant or dangling parent references.*hostel_blocks_hostel_id_tenant_fk=1 cross-tenant/,
        );
        const client = await migrator.connect();
        try {
          expect(await compositeState(client)).toEqual({ fks: 12, valid: 12, forced: 13 });
        } finally {
          client.release();
        }
      });

      it('refuses to run without lock_timeout', async () => {
        const sql = readFileSync(MIGRATION_304, 'utf8');
        let failure: unknown = null;
        await inMigratorTx(async (client) => {
          await client.query(`SET LOCAL lock_timeout = 0`);
          failure = await client.query(sql).then(
            () => null,
            (error: unknown) => error,
          );
        });
        expect(failure).not.toBeNull();
        expect(String((failure as Error).message)).toMatch(/lock_timeout/);
      });
    });
  },
);
