/**
 * PR B1 (FKB-047) — live proof that institution create/update resolve `areaId`
 * inside the caller's tenant.
 *
 * Runs as the runtime role (DATABASE_URL = proctira_app, NOSUPERUSER NOBYPASSRLS)
 * through the institution plugin and PrismaInstitutionRepository.
 *
 * Before the fix (RED, origin/main): tenant A's POST /institutions and
 * PUT /institutions/:id with tenant B's areaId answer 201/200 (the id-only FK
 * accepts another tenant's area); a random id fails with a Prisma P2003 naming
 * `institutions_area_id_fkey` (500 here, 400 behind the gateway).
 * After (GREEN): 404 NOT_FOUND with identical bodies for another tenant's id and
 * a random id; same-tenant writes keep 201/200 and a rejected update leaves the
 * row's area unchanged.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { institutionPlugin } from './institution-plugin.js';
import { PrismaInstitutionRepository } from './prisma-institution-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'institution-tenant-parent.live.test' });

type Res = { statusCode: number; body: string; json: () => Record<string, unknown> };

describe.skipIf(!DATABASE_URL)('PR B1 institution tenant-parent integrity (live Postgres)', () => {
  let pool: pg.Pool;
  let prisma: ReturnType<typeof createPrismaClient>;
  let app: FastifyInstance;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let areaA: string;
  let areaA2: string;
  let areaB: string;

  async function seedArea(tenantId: string): Promise<string> {
    const id = randomUUID();
    await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
         VALUES ($1, $2, 'B1 area', $3, 0, NULL, $4, 1, 2)`,
        [id, tenantId, `A-${id.slice(0, 8)}`, `/${id}`],
      ),
    );
    return id;
  }

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

  function createBody(areaId: string): Record<string, unknown> {
    const suffix = randomUUID().slice(0, 8);
    return {
      name: `B1 school ${suffix}`,
      code: `B1-${suffix}`,
      areaId,
      typeId: randomUUID(),
      sectorId: randomUUID(),
      ownershipId: randomUUID(),
    };
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    prisma = createPrismaClient({ datasourceUrl: DATABASE_URL });
    await ensurePgTestTenant(pool, tenantA);
    await ensurePgTestTenant(pool, tenantB);
    areaA = await seedArea(tenantA);
    areaA2 = await seedArea(tenantA);
    areaB = await seedArea(tenantB);
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      const r = request as { tenantId?: string; user?: { sub: string; roles: string[] } };
      r.tenantId = String(request.headers['x-test-tenant'] ?? '');
      r.user = { sub: 'b1-institution-live', roles: ['admin'] };
    });
    await app.register(institutionPlugin, {
      repository: new PrismaInstitutionRepository(prisma),
      academics: false,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await pool?.end();
  });

  it("FKB-047 POST /institutions: own area 201; other tenant's and random 404, identical", async () => {
    const own = await call(tenantA, 'POST', '/institutions', createBody(areaA));
    expect(own.statusCode, own.body).toBe(201);

    const foreign = await call(tenantA, 'POST', '/institutions', createBody(areaB));
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.json()).toEqual({
      code: 'NOT_FOUND',
      statusCode: 404,
      message: `Area with id '${areaB}' not found`,
    });

    const randomId = randomUUID();
    const random = await call(tenantA, 'POST', '/institutions', createBody(randomId));
    expect(random.statusCode, random.body).toBe(404);
    expect(random.body.replaceAll(randomId, '<id>')).toBe(foreign.body.replaceAll(areaB, '<id>'));
  });

  it("FKB-047 PUT /institutions/:id: own area 200; other tenant's and random 404, identical, row unchanged", async () => {
    const created = await call(tenantA, 'POST', '/institutions', createBody(areaA));
    expect(created.statusCode, created.body).toBe(201);
    const id = String(created.json()['id']);

    const own = await call(tenantA, 'PUT', `/institutions/${id}`, { areaId: areaA2 });
    expect(own.statusCode, own.body).toBe(200);
    expect(own.json()['areaId']).toBe(areaA2);

    const foreign = await call(tenantA, 'PUT', `/institutions/${id}`, { areaId: areaB });
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.json()).toEqual({
      code: 'NOT_FOUND',
      statusCode: 404,
      message: `Area with id '${areaB}' not found`,
    });

    const randomId = randomUUID();
    const random = await call(tenantA, 'PUT', `/institutions/${id}`, { areaId: randomId });
    expect(random.statusCode, random.body).toBe(404);
    expect(random.body.replaceAll(randomId, '<id>')).toBe(foreign.body.replaceAll(areaB, '<id>'));

    const row = await withPgTenant(pool, tenantA, (client) =>
      client.query(`SELECT area_id::text AS area_id FROM institutions WHERE id = $1`, [id]),
    );
    expect((row as unknown as pg.QueryResult<{ area_id: string }>).rows[0]!.area_id).toBe(areaA2);
  });
});
