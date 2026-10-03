/**
 * PRC-M367 live proof (PostgreSQL): the tenant plugin is resolution-only.
 * - a handler querying the pooled client directly (no tenant transaction) sees
 *   NO rows under FORCE RLS - never another tenant's rows;
 * - the same handler inside withTenantTransaction sees only the caller's rows.
 *
 * Runs only when TENANT_GUC_LIVE_ADMIN_URL points at a disposable database
 * where the test may create a role/table, e.g.
 *   TENANT_GUC_LIVE_ADMIN_URL=postgresql://postgres:pw@127.0.0.1:5432/postgres
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { PrismaClient, withTenantTransaction } from '@proctira/database';
import { tenantPlugin } from '../fastify-plugin.js';

const adminUrl = process.env['TENANT_GUC_LIVE_ADMIN_URL'];
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ROLE = 'm367_app';
const PW = 'm367_app_pw';

describe.skipIf(!adminUrl)('PRC-M367 tenant GUC scope (live PG)', () => {
  let admin: PrismaClient;
  let appDb: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    admin = new PrismaClient({ datasourceUrl: adminUrl });
    for (const sql of [
      `DROP TABLE IF EXISTS m367_rows`,
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN CREATE ROLE ${ROLE} LOGIN PASSWORD '${PW}' NOSUPERUSER NOBYPASSRLS; END IF; END $$`,
      `CREATE TABLE m367_rows (id serial PRIMARY KEY, tenant_id uuid NOT NULL, label text NOT NULL)`,
      `ALTER TABLE m367_rows ENABLE ROW LEVEL SECURITY`,
      `ALTER TABLE m367_rows FORCE ROW LEVEL SECURITY`,
      `CREATE POLICY m367_tenant ON m367_rows USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)`,
      `GRANT SELECT ON m367_rows TO ${ROLE}`,
      `INSERT INTO m367_rows (tenant_id, label) VALUES ('${A}', 'a-row'), ('${B}', 'b-row')`,
    ]) {
      await admin.$executeRawUnsafe(sql);
    }
    const u = new URL(adminUrl!);
    u.username = ROLE;
    u.password = PW;
    appDb = new PrismaClient({ datasourceUrl: u.toString() });

    app = Fastify();
    app.decorate('prisma', appDb as never);
    await app.register(tenantPlugin, { resolveSlugToId: false });
    app.get('/direct', async () =>
      appDb.$queryRawUnsafe<Array<{ label: string }>>('SELECT label FROM m367_rows ORDER BY label'),
    );
    app.get('/scoped', async (request) =>
      withTenantTransaction(appDb, request.tenantId!, (tx) =>
        tx.$queryRawUnsafe<Array<{ label: string }>>('SELECT label FROM m367_rows ORDER BY label'),
      ),
    );
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await appDb?.$disconnect();
    await admin?.$executeRawUnsafe('DROP TABLE IF EXISTS m367_rows');
    await admin?.$disconnect();
  });

  it('pooled query after the plugin hook sees no rows (never tenant B)', async () => {
    const res = await app.inject({ method: 'GET', url: '/direct', headers: { 'x-tenant-id': A } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('query inside withTenantTransaction sees only the caller tenant rows', async () => {
    const a = await app.inject({ method: 'GET', url: '/scoped', headers: { 'x-tenant-id': A } });
    const b = await app.inject({ method: 'GET', url: '/scoped', headers: { 'x-tenant-id': B } });
    expect(a.json()).toEqual([{ label: 'a-row' }]);
    expect(b.json()).toEqual([{ label: 'b-row' }]);
  });
});
