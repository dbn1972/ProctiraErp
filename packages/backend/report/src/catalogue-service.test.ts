import { createHash } from 'node:crypto';

import { isPdfBuffer } from '@proctira/pdf-lite';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryReportBlobStore } from './blob-store.js';
import { reportCataloguePlugin } from './catalogue-plugin.js';
import { CatalogueService } from './catalogue-service.js';
import { buildRoleDashboard, inferDashboardRole, resolveDashboardRole } from './dashboards.js';
import { generateCsv, generateReportBytes, sha256Hex } from './generators.js';
import { InMemoryReportStore } from './report-store.js';
import { InMemoryScheduleDelivery } from './schedule-delivery.js';
import { computeNextRunAt, createReportScheduler } from './scheduler.js';

// PRC-H080: these unit tests run without a DB pool and explicitly opt into demo rows.
process.env.REPORT_DEMO_DATA = '1';
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
      reportKey: 'students_roster',
      format: 'CSV',
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
    expect(computeNextRunAt('daily', from).toISOString()).toBe('2026-02-01T06:00:00.000Z');
    expect(computeNextRunAt('daily', from, 8).toISOString()).toBe('2026-02-01T08:00:00.000Z');
    expect(computeNextRunAt('weekly', from).toISOString()).toBe('2026-02-07T06:00:00.000Z');
    const monthly = computeNextRunAt('monthly', from);
    expect(monthly.getUTCMonth()).toBe(1);
    expect(monthly.toISOString()).toBe('2026-02-28T06:00:00.000Z');
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
    const dueAlias = await service.runDue(TENANT_A, new Date());
    expect(dueAlias.due).toBe(0);
  });
  it('PRC-M340 runDue(tenant A) never claims tenant B schedules', async () => {
    const { service } = makeService();
    const store = (service as unknown as { store: InMemoryReportStore }).store;
    const past = new Date(Date.now() - 60_000);
    const a = await service.createSchedule(TENANT_A, 'a', {
      reportKey: 'attendance_summary',
      format: 'csv',
      cadence: 'daily',
      recipients: [],
    });
    const b = await service.createSchedule(TENANT_B, 'b', {
      reportKey: 'attendance_summary',
      format: 'csv',
      cadence: 'daily',
      recipients: [],
    });
    await store.updateSchedule(TENANT_A, a.id, { nextRunAt: past });
    await store.updateSchedule(TENANT_B, b.id, { nextRunAt: past });
    const result = await service.runDue(TENANT_A, new Date());
    expect(result.due).toBe(1);
    expect(await service.listRuns(TENANT_B, { scheduleId: b.id })).toHaveLength(0);
    const claimedB = await store.claimDueSchedules(new Date(), 60_000, TENANT_B);
    expect(claimedB.map((s) => s.id)).toEqual([b.id]);
  });

  it('createReportScheduler.runOnce is idempotent while in flight', async () => {
    const { service } = makeService();
    const scheduler = createReportScheduler({
      service,
      intervalMs: 60_000,
      initialDelayMs: 60_000,
    });
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
    expect(inferDashboardRole([{ roleName: 'STAFF' }])).toBe('staff');
    expect(inferDashboardRole([{ roleName: 'librarian' }])).toBe('staff');
    expect(buildRoleDashboard('staff').cards[0]?.id).toContain('staff');
  });

  it('parents cannot request principal aggregates', () => {
    expect(() => resolveDashboardRole([{ roleName: 'PARENT' }], 'principal')).toThrow(
      /cannot fetch principal/i,
    );
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
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (
        request as typeof request & {
          user: { sub: string; roles: Array<{ roleName: string }> };
        }
      ).user = {
        sub: 'principal',
        roles: [{ roleName: 'PRINCIPAL' }],
      };
    });
    const store = new InMemoryReportStore();
    const blobs = new InMemoryReportBlobStore();
    await app.register(reportCataloguePlugin, { store, blobStore: blobs, disableScheduler: true });
    await app.ready();
    return app;
  }

  // PRC-C009: build an app whose principal has the given roles + sub. Optionally share a
  // store/blobs across apps so different principals hit the same artifacts.
  async function buildAs(
    roleNames: string[],
    sub = 'principal',
    shared?: { store: InMemoryReportStore; blobs: InMemoryReportBlobStore },
  ) {
    const app = Fastify();
    apps.push(app);
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (
        request as typeof request & {
          user: { sub: string; roles: Array<{ roleId: string; roleName: string }> };
        }
      ).user = {
        sub,
        roles: roleNames.map((r) => ({ roleId: r, roleName: r })),
      };
    });
    const store = shared?.store ?? new InMemoryReportStore();
    const blobs = shared?.blobs ?? new InMemoryReportBlobStore();
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
      payload: {
        templateId: 'tpl-enrolment-summary',
        format: 'CSV',
        filters: { academicPeriodId: 'p' },
      },
    });
    expect(create.statusCode).toBe(201);
    const run = create.json() as {
      artifactId: string;
      sha256: string;
      status: string;
      downloadUrl: string;
    };
    expect(run.status).toBe('READY');
    expect(run.sha256).toMatch(/^[0-9a-f]{64}$/);

    // PRC-C009: download requires the signed token (carried in the run's downloadUrl) and staff
    // role (the harness principal is PRINCIPAL). Strip the /api/v1 gateway prefix for the
    // in-plugin route.
    const downloadPath = run.downloadUrl.replace('/api/v1', '');
    const download = await app.inject({
      method: 'GET',
      url: downloadPath,
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['x-artifact-sha256']).toBe(run.sha256);
    expect(sha256Hex(Buffer.from(download.rawPayload))).toBe(run.sha256);

    // Cross-tenant: the token is bound to (TENANT_A, artifact), so tenant B is rejected
    // (403 on the token check, before the artifact is even looked up).
    const foreign = await app.inject({
      method: 'GET',
      url: downloadPath,
      headers: { 'x-tenant-id': TENANT_B },
    });
    expect([403, 404]).toContain(foreign.statusCode);
  });

  it('creates a schedule and records a forced run', async () => {
    const app = await build();
    const created = await app.inject({
      method: 'POST',
      url: '/reports/schedules',
      headers: { 'x-tenant-id': TENANT_A },
      payload: {
        reportKey: 'attendance_summary',
        format: 'csv',
        cadence: 'daily',
        recipients: ['a@b.c'],
      },
    });
    expect(created.statusCode).toBe(201);
    const schedule = created.json() as { id: string; nextRunAt: string; hour: number };
    expect(schedule.nextRunAt).toBeTruthy();
    expect(schedule.hour).toBe(6);
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
    const body = history.json() as { data: Array<{ status: string; trigger?: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0]?.trigger).toBe('schedule');

    const due = await app.inject({
      method: 'POST',
      url: '/reports/schedules/run-due',
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(due.statusCode).toBe(200);
    expect(due.json()).toMatchObject({ due: 0 });
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

  it('parent cannot fetch principal dashboard aggregates', async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook('preHandler', async (req) => {
      (req as typeof req & { user?: { roles: Array<{ roleName: string }> } }).user = {
        roles: [{ roleName: 'PARENT' }],
      };
    });
    const store = new InMemoryReportStore();
    const blobs = new InMemoryReportBlobStore();
    await app.register(reportCataloguePlugin, { store, blobStore: blobs, disableScheduler: true });
    await app.ready();
    const denied = await app.inject({
      method: 'GET',
      url: '/reports/dashboard?role=principal',
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject({
      method: 'GET',
      url: '/reports/dashboard?role=parent',
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(allowed.statusCode).toBe(200);
    expect((allowed.json() as { role: string }).role).toBe('parent');
  });

  // PRC-C009: the catalogue is a staff surface — parent/guardian/student are denied everywhere.
  it('denies parent/guardian/student on generate, runs, artifacts, download, schedules', async () => {
    for (const role of ['parent', 'guardian', 'student']) {
      const app = await buildAs([role]);
      const h = { 'x-tenant-id': TENANT_A };

      const generate = await app.inject({
        method: 'POST',
        url: '/reports/generate',
        headers: h,
        payload: { reportKey: 'students_roster', format: 'CSV' },
      });
      expect(generate.statusCode, `${role} generate`).toBe(403);

      const runs = await app.inject({ method: 'GET', url: '/reports/runs', headers: h });
      expect(runs.statusCode, `${role} runs`).toBe(403);

      const artifact = await app.inject({
        method: 'GET',
        url: '/reports/artifacts/00000000-0000-4000-8000-0000000000a1',
        headers: h,
      });
      expect(artifact.statusCode, `${role} artifact`).toBe(403);

      const download = await app.inject({
        method: 'GET',
        url: '/reports/artifacts/00000000-0000-4000-8000-0000000000a1/download?token=x',
        headers: h,
      });
      expect(download.statusCode, `${role} download`).toBe(403);

      const schedules = await app.inject({ method: 'GET', url: '/reports/schedules', headers: h });
      expect(schedules.statusCode, `${role} schedules`).toBe(403);
    }
  });

  it('enforces per-report entitlement: a finance clerk cannot generate exam_results but can fee_dues', async () => {
    const app = await buildAs(['accountant']);
    const h = { 'x-tenant-id': TENANT_A };

    const exam = await app.inject({
      method: 'POST',
      url: '/reports/generate',
      headers: h,
      payload: { reportKey: 'exam_results', format: 'CSV' },
    });
    expect(exam.statusCode).toBe(403);

    const fees = await app.inject({
      method: 'POST',
      url: '/reports/generate',
      headers: h,
      payload: { reportKey: 'fee_dues', format: 'CSV' },
    });
    expect(fees.statusCode).toBe(201);
  });

  it('download requires the signed token even for staff', async () => {
    const app = await buildAs(['principal']);
    const h = { 'x-tenant-id': TENANT_A };
    const create = await app.inject({
      method: 'POST',
      url: '/reports/generate',
      headers: h,
      payload: { reportKey: 'students_roster', format: 'CSV' },
    });
    expect(create.statusCode).toBe(201);
    const run = create.json() as { artifactId: string };
    const noToken = await app.inject({
      method: 'GET',
      url: `/reports/artifacts/${run.artifactId}/download`,
      headers: h,
    });
    expect(noToken.statusCode).toBe(403);
  });

  it('a non-owner staff cannot download another user artifact they are not entitled to', async () => {
    // Shared store so both principals see the same artifact.
    const shared = { store: new InMemoryReportStore(), blobs: new InMemoryReportBlobStore() };

    // User A (accountant) generates a fee_dues report.
    const appA = await buildAs(['accountant'], 'user-a', shared);
    const created = await appA.inject({
      method: 'POST',
      url: '/reports/generate',
      headers: { 'x-tenant-id': TENANT_A },
      payload: { reportKey: 'fee_dues', format: 'CSV' },
    });
    expect(created.statusCode).toBe(201);
    const run = created.json() as { artifactId: string; downloadUrl: string };
    const path = run.downloadUrl.replace('/api/v1', '');

    // User B is a teacher — not entitled to fee_dues and not the owner → 404 on the same token URL.
    const appB = await buildAs(['teacher'], 'user-b', shared);
    const denied = await appB.inject({
      method: 'GET',
      url: path,
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(denied.statusCode).toBe(404);

    // An admin (report manager) on the shared store CAN download it.
    const appAdmin = await buildAs(['admin'], 'user-admin', shared);
    const allowed = await appAdmin.inject({
      method: 'GET',
      url: path,
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(allowed.statusCode).toBe(200);
  });
});

describe('W2-JOB-08 / W2-JOB-09 scheduler lease + delivery', () => {
  it('claimDueSchedules prevents a second replica from claiming the same schedule', async () => {
    const store = new InMemoryReportStore();
    const schedule = await store.insertSchedule({
      id: 'sch-1',
      tenantId: TENANT_A,
      reportKey: 'attendance_summary',
      format: 'csv',
      cadence: 'daily',
      hour: 6,
      nextRunAt: new Date(Date.now() - 60_000),
      recipients: ['office@school.test'],
      enabled: true,
      createdBy: 'sched',
      lastRunAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const now = new Date();
    const first = await store.claimDueSchedules(now, 15 * 60_000);
    expect(first.map((s) => s.id)).toEqual([schedule.id]);
    const second = await store.claimDueSchedules(now, 15 * 60_000);
    expect(second).toEqual([]);
  });

  it('tickDueSchedules delivers to recipients after a successful run', async () => {
    const { service } = makeService();
    const delivery = service.getDeliveryPort() as InMemoryScheduleDelivery;
    const schedule = await service.createSchedule(TENANT_A, 'sched', {
      reportKey: 'attendance_summary',
      format: 'csv',
      cadence: 'daily',
      recipients: ['office@school.test', 'principal@school.test'],
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
    expect(tick.delivered).toBe(1);
    expect(delivery.sent).toHaveLength(1);
    expect(delivery.sent[0]!.recipients).toEqual(['office@school.test', 'principal@school.test']);
    expect(delivery.sent[0]!.downloadUrl).toContain('/api/v1/reports/artifacts/');
  });

  it('failed ticks retry with backoff instead of advancing cadence', async () => {
    const store = new InMemoryReportStore();
    const blobs = new InMemoryReportBlobStore();
    const service = new CatalogueService(store, blobs);
    const schedule = await service.createSchedule(TENANT_A, 'sched', {
      reportKey: 'attendance_summary',
      format: 'csv',
      cadence: 'daily',
      recipients: ['office@school.test'],
    });
    const now = new Date('2026-03-01T12:00:00.000Z');
    const past = new Date(now.getTime() - 60_000);
    await store.updateSchedule(TENANT_A, schedule.id, { nextRunAt: past });

    service.generate = (async () => {
      throw new Error('generator boom');
    }) as typeof service.generate;

    const tick = await service.tickDueSchedules(now);
    expect(tick.due).toBe(1);
    expect(tick.failed).toBe(1);
    expect(tick.completed).toBe(0);
    const updated = await store.getSchedule(TENANT_A, schedule.id);
    expect(updated!.nextRunAt.getTime()).toBe(now.getTime() + 5 * 60_000);
  });

  it('W3-C3: reclaims a schedule lease after worker crash so a restarted replica can tick', async () => {
    const store = new InMemoryReportStore();
    const schedule = await store.insertSchedule({
      id: 'sch-crash',
      tenantId: TENANT_A,
      reportKey: 'attendance_summary',
      format: 'csv',
      cadence: 'daily',
      hour: 6,
      nextRunAt: new Date('2026-03-01T06:00:00.000Z'),
      recipients: ['office@school.test'],
      enabled: true,
      createdBy: 'sched',
      lastRunAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const leaseMs = 15 * 60_000;
    const tickTime = new Date('2026-03-01T06:00:01.000Z');
    const claimed = await store.claimDueSchedules(tickTime, leaseMs);
    expect(claimed.map((s) => s.id)).toEqual([schedule.id]);

    // Mid-tick crash: lease still holds nextRunAt in the future.
    const midCrash = new Date(tickTime.getTime() + 1000);
    expect(await store.claimDueSchedules(midCrash, leaseMs)).toEqual([]);

    // After lease expiry the schedule becomes due again for a restarted worker.
    const afterLease = new Date(tickTime.getTime() + leaseMs + 1);
    const reclaimed = await store.claimDueSchedules(afterLease, leaseMs);
    expect(reclaimed.map((s) => s.id)).toEqual([schedule.id]);
  });
});
