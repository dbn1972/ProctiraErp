/**
 * Insights UI plugin — memory path + Postgres restart-safe smoke (G-209).
 */
import { randomUUID } from 'node:crypto';

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { insightsUiPlugin } from './insights-ui-plugin.js';
import {
  createInsightsUiStore,
  isPgInsightsUiEnabled,
  PgInsightsUiStore,
} from './insights-ui-pg-store.js';

describe('insightsUiPlugin (memory)', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    while (apps.length) {
      const app = apps.pop();
      if (app) await app.close();
    }
  });

  async function buildApp() {
    const app = Fastify();
    apps.push(app);
    await app.register(insightsUiPlugin, { forceMemory: true });
    await app.ready();
    return app;
  }

  it('lists seeded templates', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/reports/templates' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string }> };
    expect(body.data.some((t) => t.id === 'tpl-enrolment-summary')).toBe(true);
  });

  it('generates a report run and lists it for the tenant', async () => {
    const app = await buildApp();
    const tenant = 'tenant-insights-a';
    const create = await app.inject({
      method: 'POST',
      url: '/reports/generate',
      headers: { 'x-tenant-id': tenant },
      payload: { templateId: 'tpl-enrolment-summary', format: 'PDF' },
    });
    expect(create.statusCode).toBe(201);
    const run = create.json() as { id: string; status: string };
    expect(run.status).toBe('READY');

    const list = await app.inject({
      method: 'GET',
      url: '/reports/runs',
      headers: { 'x-tenant-id': tenant },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { data: Array<{ id: string }> };
    expect(body.data.some((r) => r.id === run.id)).toBe(true);
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
});

describe('PgInsightsUiStore restart-safe smoke (G-209)', () => {
  it.skipIf(!isPgInsightsUiEnabled())(
    'report run survives a second store instance (simulates restart)',
    async () => {
      const storeA = createInsightsUiStore();
      expect(storeA.persistence).toBe('postgres');
      expect(storeA).toBeInstanceOf(PgInsightsUiStore);

      const tenantId = '00000000-0000-4000-8000-000000000209';
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
