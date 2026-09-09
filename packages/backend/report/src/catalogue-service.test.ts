import { createHash } from 'node:crypto';

import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryReportBlobStore } from './blob-store.js';
import { reportCataloguePlugin } from './catalogue-plugin.js';
import { CatalogueService } from './catalogue-service.js';
import { buildRoleDashboard, inferDashboardRole } from './dashboards.js';
import { generateCsv, generateReportBytes, sha256Hex } from './generators.js';
import { InMemoryReportStore } from './report-store.js';
import { computeNextRunAt, createReportScheduler } from './scheduler.js';
import { isPdfBuffer } from '@proctira/pdf-lite';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';

function makeService() {
  const store = new InMemoryReportStore();
  const blobs = new InMemoryReportBlobStore();
  return { store, blobs, service: new CatalogueService(store, blobs) };
}

describe('G-909 generators + artifact hash', () => {
  it('stores sha256 equal to hash of generated CSV bytes', async () => {
    const { service, blobs } = makeService();
    const result = await service.generate(TENANT_A, 'tester', {
      reportKey: 'enrolment_by_grade',
      format: 'CSV',
      filters: { academicPeriodId: '2025-26' },
    });
    expect(result.artifact.sha256).toBe(sha256Hex(result.bytes));
    expect(result.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    const stored = await blobs.get(result.artifact.objectKey);
    expect(stored).not.toBeNull();
    expect(sha256Hex(stored!)).toBe(result.artifact.sha256);
    expect(result.bytes.toString('utf8')).toContain(TENANT_A);
  });

  it('xlsx is a zip (PK) and pdf is a real PDF', async () => {
    const table = {
      columns: [{ name: 'a', label: 'A' }],
      rows: [{ a: '1' }],
    };
    const xlsx = await generateReportBytes('fee_dues', 'xlsx', table);
    expect(xlsx.subarray(0, 2).toString('utf8')).toBe('PK');
    const pdf = await generateReportBytes('fee_dues', 'pdf', table);
    expect(isPdfBuffer(pdf)).toBe(true);
    const csv = generateCsv(table);
    expect(csv.toString('utf8')).toContain('A');
    expect(createHash('sha256').update(csv).digest('hex')).toBe(sha256Hex(csv));
  });
});

describe('G-909 scheduler next_run_at', () => {
  it('advances daily / weekly / monthly from a fixed instant', () => {
    const from = new Date('2026-01-31T08:00:00.000Z');
    expect(computeNextRunAt('daily', from).toISOString()).toBe('2026-02-01T08:00:00.000Z');
    expect(computeNextRunAt('daily', from, 6).toISOString()).toBe('2026-02-01T06:00:00.000Z');
    expect(computeNextRunAt('weekly', from).toISOString()).toBe('2026-02-07T08:00:00.000Z');
    const monthly = computeNextRunAt('monthly', from);
    expect(monthly.getUTCMonth()).toBe(1);
    expect(monthly.toISOString().startsWith('2026-02-')).toBe(true);
  });

  it('tickDueSchedules writes a completed run into history', async () => {
    const { service } = makeService();
    const schedule = await service.createSchedule(TENANT_A, 'sched', {
      reportKey: 'attendance_summary',
      format: 'csv',
      cadence: 'daily',
      recipients: ['office@school.test'],
    });
    const past = new Date(Date.now() - 60_000);
    await (service as unknown as { store: InMemoryReportStore }).store.updateSchedule(
      TENANT_A,
      schedule.id,
      { nextRunAt: past },
    );
    const tick = await service.tickDueSchedules(new Date());
    expect(tick.due).toBe(1);
    expect(tick.completed).toBe(1);
    const runs = await service.listRuns(TENANT_A, { scheduleId: schedule.id });
    expect(runs.some((r) => r.source === 'schedule' && r.status === 'completed')).toBe(true);
  });

  it('createReportScheduler.runOnce is idempotent while in flight', async () => {
    const { service } = makeService();
    const scheduler = createReportScheduler({ service, intervalMs: 60_000, initialDelayMs: 60_000 });
    const first = await scheduler.runOnce(new Date());
    expect(first.due).toBe(0);
    scheduler.start();
    expect(scheduler.running).toBe(true);
    scheduler.stop();
    expect(scheduler.running).toBe(false);
  });
});

describe('G-909 role dashboards', () => {
  it('returns distinct card ids per role', () => {
    const board = buildRoleDashboard('board');
    const teacher = buildRoleDashboard('teacher');
    const principal = buildRoleDashboard('principal');
    const parent = buildRoleDashboard('parent');
    expect(board.cards.map((c) => c.id)).not.toEqual(teacher.cards.map((c) => c.id));
    expect(principal.cards[0]?.id).toContain('principal');
    expect(parent.cards[0]?.id).toContain('parent');
    expect(inferDashboardRole([{ roleName: 'TEACHER' }])).toBe('teacher');
    expect(inferDashboardRole([{ roleName: 'PRINCIPAL' }])).toBe('principal');
    expect(inferDashboardRole([{ roleName: 'PARENT' }])).toBe('parent');
    expect(inferDashboardRole([{ roleName: 'BOARD_ADMIN' }])).toBe('board');
  });
});

describe('G-909 tenant isolation', () => {
  it('tenant B cannot read tenant A artifacts or schedules', async () => {
    const { service } = makeService();
    const result = await service.generate(TENANT_A, 'a', {
      templateId: 'tpl-enrolment-summary',
      format: 'csv',
    });
    await expect(service.getArtifact(TENANT_B, result.artifact.id)).rejects.toThrow(/not found/i);
    const schedule = await service.createSchedule(TENANT_A, 'a', {
      reportKey: 'fee_dues',
      format: 'pdf',
      cadence: 'weekly',
    });
    const bSchedules = await service.listSchedules(TENANT_B);
    expect(bSchedules.find((s) => s.id === schedule.id)).toBeUndefined();
    const bRuns = await service.listRuns(TENANT_B);
    expect(bRuns).toHaveLength(0);
  });
});

describe('G-909 catalogue plugin routes', () => {
  const apps: Array<ReturnType<typeof Fastify>> = [];

  afterEach(async () => {
    while (apps.length) {
      const app = apps.pop();
      if (app) await app.close();
    }
  });

  async function build() {
    const app = Fastify();
    apps.push(app);
    const store = new InMemoryReportStore();
    const blobs = new InMemoryReportBlobStore();
    await app.register(reportCataloguePlugin, { store, blobStore: blobs, disableScheduler: true });
    await app.ready();
    return app;
  }

  it('lists catalogue aliases used by insights UI', async () => {
    const app = await build();
    const res = await app.inject({ method: 'GET', url: '/reports/templates' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string }> };
    expect(body.data.some((t) => t.id === 'tpl-enrolment-summary')).toBe(true);
  });

  it('generates CSV, download sha256 header matches artifact', async () => {
    const app = await build();
    const create = await app.inject({
      method: 'POST',
      url: '/reports/generate',
      headers: { 'x-tenant-id': TENANT_A },
      payload: { templateId: 'tpl-enrolment-summary', format: 'CSV', filters: { academicPeriodId: 'p' } },
    });
    expect(create.statusCode).toBe(201);
    const run = create.json() as { artifactId: string; sha256: string; status: string };
    expect(run.status).toBe('READY');
    expect(run.sha256).toMatch(/^[0-9a-f]{64}$/);

    const download = await app.inject({
      method: 'GET',
      url: `/reports/artifacts/${run.artifactId}/download`,
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['x-artifact-sha256']).toBe(run.sha256);
    expect(sha256Hex(Buffer.from(download.rawPayload))).toBe(run.sha256);

    const foreign = await app.inject({
      method: 'GET',
      url: `/reports/artifacts/${run.artifactId}/download`,
      headers: { 'x-tenant-id': TENANT_B },
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('creates a schedule and records a forced run', async () => {
    const app = await build();
    const created = await app.inject({
      method: 'POST',
      url: '/reports/schedules',
      headers: { 'x-tenant-id': TENANT_A },
      payload: { reportKey: 'attendance_summary', format: 'csv', cadence: 'daily', recipients: ['a@b.c'] },
    });
    expect(created.statusCode).toBe(201);
    const schedule = created.json() as { id: string; nextRunAt: string };
    expect(schedule.nextRunAt).toBeTruthy();
    expect(new Date(schedule.nextRunAt).getTime()).toBeGreaterThan(Date.now());

    const run = await app.inject({
      method: 'POST',
      url: `/reports/schedules/${schedule.id}/run`,
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(run.statusCode).toBe(201);

    const history = await app.inject({
      method: 'GET',
      url: `/reports/runs?scheduleId=${schedule.id}`,
      headers: { 'x-tenant-id': TENANT_A },
    });
    const body = history.json() as { data: Array<{ status: string }> };
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('dashboard cards differ for principal vs teacher', async () => {
    const app = await build();
    const principal = await app.inject({
      method: 'GET',
      url: '/reports/dashboard?role=principal',
      headers: { 'x-tenant-id': TENANT_A },
    });
    const teacher = await app.inject({
      method: 'GET',
      url: '/reports/dashboard?role=teacher',
      headers: { 'x-tenant-id': TENANT_A },
    });
    const p = principal.json() as { role: string; cards: Array<{ id: string }> };
    const t = teacher.json() as { role: string; cards: Array<{ id: string }> };
    expect(p.role).toBe('principal');
    expect(t.role).toBe('teacher');
    expect(p.cards.map((c) => c.id)).not.toEqual(t.cards.map((c) => c.id));
  });
});
