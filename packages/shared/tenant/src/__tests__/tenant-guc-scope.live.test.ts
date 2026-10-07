/**
 * PRC-M367 live proof (PostgreSQL): the tenant plugin is resolution-only.
 * - a handler querying the pooled client directly (no tenant transaction) sees
 *   NO rows under FORCE RLS - never another tenant's rows;
 * - the same handler inside withTenantTransaction sees only the caller's rows.
 *
 * Uses the same connections as every other `*.live.test.ts` suite so the
 * W3-TEST-03 live gate executes it (a skip there fails CI):
 *   DATABASE_URL           runtime role (proctira_app in CI: non-owner, NOBYPASSRLS)
 *   MIGRATOR_DATABASE_URL  database owner (proctira in CI) that creates the fixture
 * The fixture lives in its own schema so catalog-wide live checks on `public`
 * never observe it, and it is dropped in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient, withTenantTransaction } from '@proctira/database';
import { tenantPlugin } from '../fastify-plugin.js';

const subjectUrl = process.env['DATABASE_URL']?.trim() || undefined;
const ownerUrl = process.env['MIGRATOR_DATABASE_URL']?.trim() || undefined;
const live = Boolean(subjectUrl && ownerUrl);

// W3-TEST-03: a required live run must fail loudly rather than skip silently.
if (!live && process.env['REQUIRE_LIVE_TESTS'] === '1') {
  throw new Error(
    '[W3-TEST-03] PRC-M367 tenant GUC scope live proof needs DATABASE_URL and MIGRATOR_DATABASE_URL',
  );
}

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SCHEMA = 'prc_m367_live';
const TABLE = `${SCHEMA}.tenant_rows`;
const SELECT_ROWS = `SELECT label FROM ${TABLE} ORDER BY label`;

describe.skipIf(!live)('PRC-M367 tenant GUC scope (live PG)', () => {
  let owner: PrismaClient;
  let appDb: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    owner = new PrismaClient({ datasourceUrl: ownerUrl });
    appDb = new PrismaClient({ datasourceUrl: subjectUrl });

    // The proof is only meaningful if the runtime role cannot bypass RLS and
    // does not own the table (owners are exempt unless FORCE is set; we set it
    // anyway, but a superuser/BYPASSRLS role would make every assertion vacuous).
    const [subject] = await appDb.$queryRawUnsafe<
      Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>
    >('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
    expect(subject).toBeDefined();
    expect(subject!.rolsuper).toBe(false);
    expect(subject!.rolbypassrls).toBe(false);
    const subjectRole = subject!.rolname.replace(/"/g, '""');

    // Seed before enabling RLS: the owner is NOBYPASSRLS in CI and FORCE RLS
    // would otherwise reject its own unscoped inserts.
    for (const sql of [
      `DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`,
      `CREATE SCHEMA ${SCHEMA}`,
      `CREATE TABLE ${TABLE} (id serial PRIMARY KEY, tenant_id uuid NOT NULL, label text NOT NULL)`,
      `INSERT INTO ${TABLE} (tenant_id, label) VALUES ('${A}', 'a-row'), ('${B}', 'b-row')`,
      `ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE ${TABLE} FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY m367_tenant ON ${TABLE} USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`,
      `GRANT USAGE ON SCHEMA ${SCHEMA} TO "${subjectRole}"`,
      `GRANT SELECT ON ${TABLE} TO "${subjectRole}"`,
    ]) {
      await owner.$executeRawUnsafe(sql);
    }

    app = Fastify();
    app.decorate('prisma', appDb as never);
    await app.register(tenantPlugin, { resolveSlugToId: false });
    app.get('/direct', async () => appDb.$queryRawUnsafe<Array<{ label: string }>>(SELECT_ROWS));
    app.get('/scoped', async (request) =>
      withTenantTransaction(appDb, request.tenantId!, (tx) =>
        tx.$queryRawUnsafe<Array<{ label: string }>>(SELECT_ROWS),
      ),
    );
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await appDb?.$disconnect();
    await owner?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await owner?.$disconnect();
  });

  it('pooled query after the plugin hook sees no rows (never tenant B)', async () => {
    const res = await app.inject({ method: 'GET', url: '/direct', headers: { 'x-tenant-id': A } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('query inside withTenantTransaction sees only the caller tenant rows', async () => {
    const a = await app.inject({ method: 'GET', url: '/scoped', headers: { 'x-tenant-id': A } });
    const b = await app.inject({ method: 'GET', url: '/scoped', headers: { 'x-tenant-id': B } });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json()).toEqual([{ label: 'a-row' }]);
    expect(b.json()).toEqual([{ label: 'b-row' }]);
    // The bind is transaction-local: once the transaction ends, a pooled query
    // on the same client is unscoped again and sees nothing.
    const after = await app.inject({
      method: 'GET',
      url: '/direct',
      headers: { 'x-tenant-id': B },
    });
    expect(after.json()).toEqual([]);
  });
});
