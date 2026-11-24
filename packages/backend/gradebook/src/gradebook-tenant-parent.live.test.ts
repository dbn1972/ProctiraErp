/**
 * PR B1 (FKB-015) — live proof that credit rules resolve `boardId` inside the
 * caller's tenant.
 *
 * Runs as the runtime role (DATABASE_URL = proctira_app, NOSUPERUSER NOBYPASSRLS)
 * through the gradebook plugin and PgGradebookRepository.
 *
 * Before the fix (RED, origin/main): tenant A's POST /gradebook/credit-rules with
 * tenant B's boardId answers 201 (the id-only FK accepts another tenant's board);
 * a random id answers 400 naming the constraint column.
 * After (GREEN): 404 NOT_FOUND with identical bodies for another tenant's id and
 * a random id; same-tenant and board-less writes keep 201.
 */
import { randomUUID } from 'node:crypto';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gradebookPlugin } from './gradebook-plugin.js';
import { PgGradebookRepository } from './pg-gradebook-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'gradebook-tenant-parent.live.test' });

type Res = { statusCode: number; body: string; json: () => Record<string, unknown> };

describe.skipIf(!DATABASE_URL)('PR B1 gradebook tenant-parent integrity (live Postgres)', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  let boardA: string;
  let boardB: string;

  async function seedBoard(tenantId: string): Promise<string> {
    const id = randomUUID();
    await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `INSERT INTO boards (id, tenant_id, name, code, type) VALUES ($1, $2, 'B1 board', $3, 'STATE')`,
        [id, tenantId, `B1-${id.slice(0, 8)}`],
      ),
    );
    return id;
  }

  async function postRule(tenantId: string, boardId: string | null): Promise<Res> {
    const code = `B1-${randomUUID().slice(0, 8)}`;
    const res = await app.inject({
      method: 'POST',
      url: '/gradebook/credit-rules',
      payload: { code, name: `Rule ${code}`, credits: 3, boardId },
      headers: { 'x-test-tenant': tenantId },
    });
    return { statusCode: res.statusCode, body: res.body, json: () => res.json() };
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    await ensurePgTestTenant(pool, tenantA);
    await ensurePgTestTenant(pool, tenantB);
    boardA = await seedBoard(tenantA);
    boardB = await seedBoard(tenantB);
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      const r = request as { tenantId?: string; user?: { sub: string; roles: string[] } };
      r.tenantId = String(request.headers['x-test-tenant'] ?? '');
      r.user = { sub: 'b1-gradebook-live', roles: ['admin'] };
    });
    await app.register(gradebookPlugin, {
      repository: new PgGradebookRepository(pool),
      prefix: '/gradebook',
    });
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it("FKB-015 POST /gradebook/credit-rules: own board 201; other tenant's and random 404, identical", async () => {
    const own = await postRule(tenantA, boardA);
    expect(own.statusCode, own.body).toBe(201);
    expect(own.json()['boardId']).toBe(boardA);

    const foreign = await postRule(tenantA, boardB);
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.json()).toEqual({
      code: 'NOT_FOUND',
      statusCode: 404,
      message: `Board with id '${boardB}' not found`,
    });

    const randomId = randomUUID();
    const random = await postRule(tenantA, randomId);
    expect(random.statusCode, random.body).toBe(404);
    expect(random.body.replaceAll(randomId, '<id>')).toBe(foreign.body.replaceAll(boardB, '<id>'));

    const rows = await withPgTenant(pool, tenantA, (client) =>
      client.query(`SELECT count(*)::int AS n FROM credit_rules WHERE board_id = $1`, [boardB]),
    );
    expect((rows as unknown as pg.QueryResult<{ n: number }>).rows[0]!.n).toBe(0);
  });

  it('FKB-015 POST /gradebook/credit-rules without a board keeps 201', async () => {
    const res = await postRule(tenantA, null);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()['boardId']).toBeNull();
  });
});
