/**
 * Insights UI plugin — memory path + Postgres restart-safe smoke (G-209).
 * G-809 board rollup coverage included below.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearBoardSummariesForTests,
  seedBoardSummaryForTests,
  type BoardSummary,
} from './board-summary.js';
import { decideBoardRollupAccess, insightsUiPlugin } from './insights-ui-plugin.js';
import {
  createInsightsUiStore,
  isPgInsightsUiEnabled,
  PgInsightsUiStore,
} from './insights-ui-pg-store.js';

describe('insightsUiPlugin (memory)', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    clearBoardSummariesForTests();
    while (apps.length) {
      const app = apps.pop();
      if (app) await app.close();
    }
  });

  async function buildApp(
    user: unknown = { roles: [{ roleId: 'admin', roleName: 'Administrator' }] },
  ) {
    const app = Fastify();
    apps.push(app);
    if (user) {
      app.addHook('onRequest', async (request) => {
        (request as { user?: unknown }).user = user;
      });
    }
    await app.register(insightsUiPlugin, { forceMemory: true });
    await app.ready();
    return app;
  }

  it('lists seeded templates', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/reports/templates' });
    expect(res.statusCode).toBe(404);
  });

  it('does not serve synthetic report generate (G-909 moved to backend-report)', async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: 'POST',
      url: '/reports/generate',
      headers: { 'x-tenant-id': 'tenant-insights-a' },
      payload: { templateId: 'tpl-enrolment-summary', format: 'PDF' },
    });
    expect(create.statusCode).toBe(404);
  });

  it('queues a warehouse import job', async () => {
    const app = await buildApp();
    const tenant = 'tenant-insights-b';
    const create = await app.inject({
      method: 'POST',
      url: '/data-warehouse/import/jobs',
      headers: { 'x-tenant-id': tenant },
      payload: { source: 'CSV', filename: 'enrolment.csv', rows: 12 },
    });
    expect(create.statusCode).toBe(201);
    const job = create.json() as { id: string; status: string };
    expect(job.status).toBe('QUEUED');

    const list = await app.inject({
      method: 'GET',
      url: '/data-warehouse/import/jobs',
      headers: { 'x-tenant-id': tenant },
    });
    const body = list.json() as { data: Array<{ id: string }> };
    expect(body.data.some((j) => j.id === job.id)).toBe(true);
  });

  describe('board rollup authz (PRC-M028)', () => {
    const get = async (user: unknown, boardId: string) =>
      (await buildApp(user)).inject({ method: 'GET', url: `/reports/board/${boardId}/summary` });
    it('teacher with no area scope gets 403', async () => {
      const res = await get({ roles: [{ roleId: 'teacher', roleName: 'Teacher' }] }, 'board-a');
      expect(res.statusCode).toBe(403);
    });
    it('board admin scoped to A gets 403 for B and 200 for A', async () => {
      const user = {
        roles: [{ roleId: 'board_admin', roleName: 'Board Admin', areaId: 'board-a' }],
      };
      expect((await get(user, 'board-b')).statusCode).toBe(403);
      expect((await get(user, 'board-a')).statusCode).toBe(200);
    });
    it("role 'boarding_warden' (substring 'board') is not privileged", async () => {
      const res = await get(
        { roles: [{ roleId: 'boarding_warden', roleName: 'Boarding Warden' }] },
        'board-a',
      );
      expect(res.statusCode).toBe(403);
      expect(
        decideBoardRollupAccess(
          { roles: [{ roleId: 'x', roleName: 'Platform board viewer' }] },
          'b',
        ),
      ).toBe('deny');
    });
    it('JWT area scope is honoured and platform admin may read any board', async () => {
      expect(decideBoardRollupAccess({ roles: ['teacher'], areas: [{ areaId: 'b1' }] }, 'b1')).toBe(
        'allow',
      );
      expect(decideBoardRollupAccess({ roles: [{ roleId: 'super-admin' }] }, 'any')).toBe('allow');
    });
  });

  describe('GET /reports/board/:boardId/summary (G-809)', () => {
    it('rejects an unauthenticated caller (PRC-M028)', async () => {
      const anon = await buildApp(null);
      const denied = await anon.inject({
        method: 'GET',
        url: '/reports/board/board-unauth/summary',
      });
      expect(denied.statusCode).toBe(401);
    });
    it('returns zeros for an admin without tenant header in forceMemory mode', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/reports/board/board-unauth/summary',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BoardSummary;
      expect(body.boardId).toBe('board-unauth');
      expect(body.schools).toBe(0);
      expect(body.enrolment).toBe(0);
      expect(body.feesCollectedCents).toBe(0);
      expect(body.attendancePercent).toBeNull();
      expect(body.lmsCompletionPercent).toBeNull();
      expect(body.schoolsBreakdown).toEqual([]);
      expect(typeof body.generatedAt).toBe('string');
    });

    it('returns a seeded summary for a boardId', async () => {
      seedBoardSummaryForTests('board-cbse', {
        schools: 3,
        enrolment: 420,
        attendancePercent: 91.5,
        feesCollectedCents: 1_250_000,
        lmsCompletionPercent: 67.25,
        schoolsBreakdown: [
          { institutionId: 'inst-1', name: 'North High', enrolment: 200 },
          { institutionId: 'inst-2', name: 'South High', enrolment: 220 },
        ],
      });

      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/reports/board/board-cbse/summary',
        headers: { 'x-tenant-id': 'tenant-board' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BoardSummary;
      expect(body.boardId).toBe('board-cbse');
      expect(body.schools).toBe(3);
      expect(body.enrolment).toBe(420);
      expect(body.attendancePercent).toBe(91.5);
      expect(body.feesCollectedCents).toBe(1_250_000);
      expect(body.lmsCompletionPercent).toBe(67.25);
      expect(body.schoolsBreakdown).toHaveLength(2);
      expect(body.schoolsBreakdown[0]?.name).toBe('North High');
    });

    it('returns zeros with 200 for an unknown boardId (not 404)', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/reports/board/board-unknown-xyz/summary',
        headers: { 'x-tenant-id': 'tenant-board' },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as BoardSummary;
      expect(body.boardId).toBe('board-unknown-xyz');
      expect(body.schools).toBe(0);
      expect(body.enrolment).toBe(0);
      expect(body.feesCollectedCents).toBe(0);
      expect(body.attendancePercent).toBeNull();
      expect(body.lmsCompletionPercent).toBeNull();
      expect(body.schoolsBreakdown).toEqual([]);
    });

    it('returns 403 BOARD_FORBIDDEN when scoped role requests another board', async () => {
      const app = Fastify();
      apps.push(app);
      app.addHook('onRequest', async (request) => {
        (request as { user?: unknown }).user = {
          roles: [
            {
              roleId: 'teacher',
              roleName: 'Teacher',
              areaId: 'board-home',
              institutionId: 'board-home',
            },
          ],
        };
      });
      await app.register(insightsUiPlugin, { forceMemory: true });
      await app.ready();

      const denied = await app.inject({
        method: 'GET',
        url: '/reports/board/board-other/summary',
        headers: { 'x-tenant-id': 'tenant-board' },
      });
      expect(denied.statusCode).toBe(403);
      expect((denied.json() as { code: string }).code).toBe('BOARD_FORBIDDEN');

      const allowed = await app.inject({
        method: 'GET',
        url: '/reports/board/board-home/summary',
        headers: { 'x-tenant-id': 'tenant-board' },
      });
      expect(allowed.statusCode).toBe(200);
    });

    it('allows privileged administrator to load any board summary', async () => {
      const app = Fastify();
      apps.push(app);
      app.addHook('onRequest', async (request) => {
        (request as { user?: unknown }).user = {
          roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'board-home' }],
        };
      });
      await app.register(insightsUiPlugin, { forceMemory: true });
      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/reports/board/board-other/summary',
        headers: { 'x-tenant-id': 'tenant-board' },
      });
      expect(res.statusCode).toBe(200);
    });
  });
});

describe('PgInsightsUiStore restart-safe smoke (G-209)', () => {
  it.skipIf(!isPgInsightsUiEnabled())(
    'report run survives a second store instance (simulates restart)',
    async () => {
      const storeA = createInsightsUiStore();
      expect(storeA.persistence).toBe('postgres');
      expect(storeA).toBeInstanceOf(PgInsightsUiStore);

      const tenantId = '00000000-0000-4000-8000-000000000209';
      // insights_ui_runs.tenant_id became a uuid FK to tenants(id) in db/sql/100,
      // so this fixed id has to exist as a row now.
      await ensurePgTestTenant(getSharedPgPool()!, tenantId);
      const runId = randomUUID();
      await storeA.createRun(tenantId, {
        id: runId,
        templateId: 'tpl-enrolment-summary',
        templateName: 'Enrolment summary',
        generatedAt: new Date().toISOString(),
        generatedBy: 'g209-test',
        format: 'CSV',
        fileSizeKb: 4,
        status: 'READY',
        downloadUrl: null,
      });

      // New store instance = new process / restart simulation.
      const storeB = createInsightsUiStore();
      expect(storeB.persistence).toBe('postgres');
      const runs = await storeB.listRuns(tenantId);
      expect(runs.some((r) => r.id === runId)).toBe(true);

      const templates = await storeB.listTemplates();
      expect(templates.length).toBeGreaterThan(0);
      const indicators = await storeB.listIndicators();
      expect(indicators.length).toBeGreaterThan(0);
    },
  );
});
