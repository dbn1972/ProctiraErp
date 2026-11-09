/**
 * PRC-L340 (topic 5 — audit trail): the mounted report catalogue must emit an
 * audit EVENT for report GENERATE, DOWNLOAD and SCHEDULE actions through an
 * injected audit sink, recording the actor, tenant and field names (report key,
 * artifact/schedule id, format, action) — never PHI values. This is event
 * emission only; the same-transaction keyed hash chain is a separate concern
 * (B07 t1-audit-integrity-batch5) and is intentionally out of scope here.
 *
 * Failing-first: on base the catalogue routes make NO audit call on generate,
 * download or schedule, so a recording sink stays empty. With the fix each
 * action produces exactly one audit event carrying the actor + tenant + action
 * and no PHI values.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { InMemoryReportBlobStore } from './blob-store.js';
import { reportCataloguePlugin } from './catalogue-plugin.js';
import { RecordingReportAuditPort, type ReportAuditEvent } from './report-audit.js';
import { InMemoryReportStore } from './report-store.js';

const TENANT_A = '00000000-0000-4000-8000-00000000a0a0';
const ACTOR_A = 'principal-a';

const apps: FastifyInstance[] = [];
const savedDemo = process.env.REPORT_DEMO_DATA;

beforeAll(() => {
  process.env.REPORT_DEMO_DATA = '1';
});

afterAll(() => {
  if (savedDemo === undefined) delete process.env.REPORT_DEMO_DATA;
  else process.env.REPORT_DEMO_DATA = savedDemo;
});

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

async function appWithAudit(audit: RecordingReportAuditPort): Promise<{
  app: FastifyInstance;
  store: InMemoryReportStore;
}> {
  const store = new InMemoryReportStore();
  const blobs = new InMemoryReportBlobStore();
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { user: unknown }).user = {
      sub: ACTOR_A,
      tenantId: TENANT_A,
      roles: [{ roleId: 'principal', roleName: 'principal' }],
    };
  });
  await app.register(reportCataloguePlugin, {
    store,
    blobStore: blobs,
    disableScheduler: true,
    audit,
  });
  await app.ready();
  return { app, store };
}

function assertNoPhiValues(event: ReportAuditEvent): void {
  // The event records field NAMES and identifiers only. It must never carry a
  // free-form payload that could echo report row values / PHI.
  const serialized = JSON.stringify(event);
  expect(serialized).not.toContain('date_of_birth');
  expect(serialized).not.toContain('"rows"');
}

describe('PRC-L340 report catalogue emits audit events', () => {
  it('emits an audit event on report generation', async () => {
    const audit = new RecordingReportAuditPort();
    const { app } = await appWithAudit(audit);

    const gen = await app.inject({
      method: 'POST',
      url: '/reports/generate',
      payload: { reportKey: 'students_roster', format: 'CSV' },
    });
    expect(gen.statusCode).toBe(201);

    const events = audit.events.filter((e) => e.action === 'report.generate');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.tenantId).toBe(TENANT_A);
    expect(event.actorId).toBe(ACTOR_A);
    expect(event.reportKey).toBe('students_roster');
    expect(event.format).toBe('csv');
    expect(event.artifactId).toBeTruthy();
    assertNoPhiValues(event);
  });

  it('emits an audit event on report download', async () => {
    const audit = new RecordingReportAuditPort();
    const { app } = await appWithAudit(audit);

    const gen = await app.inject({
      method: 'POST',
      url: '/reports/generate',
      payload: { reportKey: 'students_roster', format: 'CSV' },
    });
    expect(gen.statusCode).toBe(201);
    const { artifactId, downloadUrl } = gen.json() as {
      artifactId: string;
      downloadUrl: string;
    };
    const token = new URL(downloadUrl, 'http://local').searchParams.get('token');
    expect(token).toBeTruthy();

    const dl = await app.inject({
      method: 'GET',
      url: `/reports/artifacts/${artifactId}/download?token=${encodeURIComponent(token!)}`,
    });
    expect(dl.statusCode).toBe(200);

    const events = audit.events.filter((e) => e.action === 'report.download');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.tenantId).toBe(TENANT_A);
    expect(event.actorId).toBe(ACTOR_A);
    expect(event.artifactId).toBe(artifactId);
    assertNoPhiValues(event);
  });

  it('emits an audit event on schedule creation', async () => {
    const audit = new RecordingReportAuditPort();
    const { app } = await appWithAudit(audit);

    const created = await app.inject({
      method: 'POST',
      url: '/reports/schedules',
      payload: {
        reportKey: 'students_roster',
        format: 'CSV',
        cadence: 'daily',
        recipients: ['ops@example.test'],
      },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };

    const events = audit.events.filter((e) => e.action === 'report.schedule.create');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.tenantId).toBe(TENANT_A);
    expect(event.actorId).toBe(ACTOR_A);
    expect(event.reportKey).toBe('students_roster');
    expect(event.scheduleId).toBe(id);
    // The recipients list is a destination, not PHI, but the audit event must
    // not echo it as a value — only that a schedule was created is recorded.
    expect(JSON.stringify(event)).not.toContain('ops@example.test');
    assertNoPhiValues(event);
  });

  it('does not fail the request when the audit sink throws', async () => {
    // Audit emission must not take down the user operation (it is event
    // emission, not the same-tx chain). A throwing sink is logged, not fatal.
    const audit = new RecordingReportAuditPort();
    audit.failNext = true;
    const { app } = await appWithAudit(audit);

    const gen = await app.inject({
      method: 'POST',
      url: '/reports/generate',
      payload: { reportKey: 'students_roster', format: 'CSV' },
    });
    expect(gen.statusCode).toBe(201);
  });
});
