/**
 * UAT-SEC-001 (PRC-C009 contract, regressed by the PRC-L337 owner-bound
 * token): a report artifact download that crosses tenants, or that presents a
 * missing or invalid signed token, must be refused with 403 and a generic
 * body, must never return artifact bytes, and must record a denial audit event
 * attributed to the CALLER tenant and actor only.
 *
 * Failing-first: on the unfixed #700 head the tenant-scoped artifact lookup
 * runs before the token check, so a tenant-B caller replaying tenant A's
 * signed URL gets 404 NOT_FOUND (not 403), and no denial event is emitted.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { InMemoryReportBlobStore } from './blob-store.js';
import { reportCataloguePlugin } from './catalogue-plugin.js';
import { RecordingReportAuditPort, type ReportAuditEvent } from './report-audit.js';
import { InMemoryReportStore } from './report-store.js';

const TENANT_A = '00000000-0000-4000-8000-00000000a0a0';
const TENANT_B = '00000000-0000-4000-8000-00000000b0b0';
const ACTOR_A = 'principal-a';
const ACTOR_B = 'principal-b';
const DENIED_ACTION = 'report.download.denied';

interface Shared {
  store: InMemoryReportStore;
  blobs: InMemoryReportBlobStore;
}

const apps: FastifyInstance[] = [];
const savedDemo = process.env.REPORT_DEMO_DATA;

beforeAll(() => {
  // No DB pool in unit tests: providers must be explicitly opted into demo rows (PRC-H080).
  process.env.REPORT_DEMO_DATA = '1';
});

afterAll(() => {
  if (savedDemo === undefined) delete process.env.REPORT_DEMO_DATA;
  else process.env.REPORT_DEMO_DATA = savedDemo;
});

afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

/**
 * A caller verified for `tenantId` (tenant comes from the principal, as from a JWT).
 * Defaults to a report manager (`principal`).
 */
async function appAs(
  tenantId: string,
  sub: string,
  shared: Shared,
  audit: RecordingReportAuditPort,
  role = 'principal',
): Promise<FastifyInstance> {
  const app = Fastify();
  apps.push(app);
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { user: unknown }).user = {
      sub,
      tenantId,
      roles: [{ roleId: role, roleName: role }],
    };
  });
  await app.register(reportCataloguePlugin, {
    store: shared.store,
    blobStore: shared.blobs,
    disableScheduler: true,
    audit,
  });
  await app.ready();
  return app;
}

async function tenantAArtifact(): Promise<{
  shared: Shared;
  artifactId: string;
  path: string;
  bytes: string;
}> {
  const shared: Shared = { store: new InMemoryReportStore(), blobs: new InMemoryReportBlobStore() };
  const ownerA = await appAs(TENANT_A, ACTOR_A, shared, new RecordingReportAuditPort());
  const gen = await ownerA.inject({
    method: 'POST',
    url: '/reports/generate',
    payload: { reportKey: 'students_roster', format: 'CSV' },
  });
  expect(gen.statusCode).toBe(201);
  const { artifactId, downloadUrl } = gen.json() as { artifactId: string; downloadUrl: string };
  const path = downloadUrl.replace('/api/v1', '');
  // The owner can download it: these are the bytes that must never reach tenant B.
  const own = await ownerA.inject({ method: 'GET', url: path });
  expect(own.statusCode).toBe(200);
  expect(own.body.length).toBeGreaterThan(0);
  return { shared, artifactId, path, bytes: own.body };
}

function expectGenericDenial(
  res: { statusCode: number; body: string; headers: Record<string, unknown> },
  bytes: string,
): void {
  expect(res.statusCode).toBe(403);
  expect(res.json()).toMatchObject({ code: 'FORBIDDEN', statusCode: 403 });
  // No artifact bytes and no download headers.
  expect(res.headers['content-disposition']).toBeUndefined();
  expect(res.headers['x-artifact-sha256']).toBeUndefined();
  expect(res.body).not.toContain(bytes);
  // The body names nothing from tenant A.
  expect(res.body).not.toContain(TENANT_A);
  expect(res.body).not.toContain(ACTOR_A);
}

function expectDenialEvent(
  audit: RecordingReportAuditPort,
  artifactId: string,
  reason: string,
): ReportAuditEvent {
  expect(audit.events.filter((e) => e.action === 'report.download')).toHaveLength(0);
  const denied = audit.events.filter((e) => e.action === DENIED_ACTION);
  expect(denied).toHaveLength(1);
  const event = denied[0]!;
  expect(event.tenantId).toBe(TENANT_B);
  expect(event.actorId).toBe(ACTOR_B);
  expect(event.artifactId).toBe(artifactId);
  expect(event.reason).toBe(reason);
  // Nothing about tenant A's artifact (tenant, owner, report key, format) is echoed.
  const serialized = JSON.stringify(event);
  expect(serialized).not.toContain(TENANT_A);
  expect(serialized).not.toContain(ACTOR_A);
  expect(serialized).not.toContain('students_roster');
  return event;
}

describe('UAT-SEC-001 cross-tenant report artifact download is denied with 403 and audited', () => {
  it('refuses tenant A signed URL replayed by tenant B (403, no bytes, denial audited)', async () => {
    const { shared, artifactId, path, bytes } = await tenantAArtifact();
    const auditB = new RecordingReportAuditPort();
    const attackerB = await appAs(TENANT_B, ACTOR_B, shared, auditB);

    const res = await attackerB.inject({ method: 'GET', url: path });

    expectGenericDenial(res, bytes);
    expectDenialEvent(auditB, artifactId, 'artifact_not_found');
  });

  it('refuses tenant B with an invalid token for tenant A artifact (403, no bytes, denial audited)', async () => {
    const { shared, artifactId, bytes } = await tenantAArtifact();
    const auditB = new RecordingReportAuditPort();
    const attackerB = await appAs(TENANT_B, ACTOR_B, shared, auditB);
    const forged = `${Math.floor(Date.now() / 1000) + 300}.${'ab'.repeat(32)}`;

    const res = await attackerB.inject({
      method: 'GET',
      url: `/reports/artifacts/${artifactId}/download?token=${encodeURIComponent(forged)}`,
    });

    expectGenericDenial(res, bytes);
    expectDenialEvent(auditB, artifactId, 'artifact_not_found');
  });

  it('refuses tenant B with no token for tenant A artifact (403, no bytes, denial audited)', async () => {
    const { shared, artifactId, bytes } = await tenantAArtifact();
    const auditB = new RecordingReportAuditPort();
    const attackerB = await appAs(TENANT_B, ACTOR_B, shared, auditB);

    const res = await attackerB.inject({
      method: 'GET',
      url: `/reports/artifacts/${artifactId}/download`,
    });

    expectGenericDenial(res, bytes);
    expectDenialEvent(auditB, artifactId, 'token_missing');
  });

  it('does not reveal artifact existence to a same-tenant caller with an invalid token', async () => {
    const { shared, artifactId } = await tenantAArtifact();
    const auditA = new RecordingReportAuditPort();
    const managerA = await appAs(TENANT_A, 'principal-a2', shared, auditA);
    const forged = encodeURIComponent(`${Math.floor(Date.now() / 1000) + 300}.${'cd'.repeat(32)}`);

    const existing = await managerA.inject({
      method: 'GET',
      url: `/reports/artifacts/${artifactId}/download?token=${forged}`,
    });
    const missing = await managerA.inject({
      method: 'GET',
      url: `/reports/artifacts/00000000-0000-4000-8000-0000000000f1/download?token=${forged}`,
    });

    // Same status and same body whether or not the id exists in the tenant.
    expect(existing.statusCode).toBe(403);
    expect(missing.statusCode).toBe(403);
    expect(existing.body).toBe(missing.body);
    expect(auditA.events.map((e) => [e.action, e.reason])).toEqual([
      [DENIED_ACTION, 'token_invalid'],
      [DENIED_ACTION, 'artifact_not_found'],
    ]);
  });

  it('checks the token before the owner gate for a same-tenant non-manager (no existence oracle)', async () => {
    const { shared, artifactId } = await tenantAArtifact();
    const auditA = new RecordingReportAuditPort();
    // `teacher` is report staff and entitled to students_roster, but is neither
    // a report manager nor the artifact owner, so `mayAccessArtifact` is false.
    const teacherA = await appAs(TENANT_A, 'teacher-a', shared, auditA, 'teacher');
    const forged = encodeURIComponent(`${Math.floor(Date.now() / 1000) + 300}.${'ef'.repeat(32)}`);

    const existing = await teacherA.inject({
      method: 'GET',
      url: `/reports/artifacts/${artifactId}/download?token=${forged}`,
    });
    const missing = await teacherA.inject({
      method: 'GET',
      url: `/reports/artifacts/00000000-0000-4000-8000-0000000000f2/download?token=${forged}`,
    });

    // If the owner gate ran first, the existing id would be 404 and the missing id 403.
    expect(existing.statusCode).toBe(403);
    expect(missing.statusCode).toBe(403);
    expect(existing.body).toBe(missing.body);
    expect(auditA.events.map((e) => [e.action, e.reason])).toEqual([
      [DENIED_ACTION, 'token_invalid'],
      [DENIED_ACTION, 'artifact_not_found'],
    ]);
  });
});
