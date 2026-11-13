/**
 * UAT-SEC-001 / PRC-L337 / PRC-L340 — gateway wiring: the mounted report catalogue must write
 * its generate, download, download-denied and schedule-create events to the keyed
 * `audit_log_entries` chain (`domainAuditSink('report')`), not to the plugin's no-op default.
 *
 * Failing-first: on origin/main 6eb8f809 the gateway mounts `reportCataloguePlugin` with no
 * `audit` option, so none of these requests appends a `report.*` audit row.
 *
 * Runs the real `buildApp` (JWT auth, tenant hook, domain mount). DATABASE_URL stays unset so
 * the report store is in-memory; only `getSharedPgPool` is replaced with a recording fake
 * pool, as in domain-audit-sink.test.ts.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  authHeaders,
  createTestConfig,
  OTHER_TENANT_ID,
  TEST_TENANT_ID,
} from './__tests__/gateway-test-kit.js';

delete process.env['DATABASE_URL'];
process.env['REPORT_DEMO_DATA'] = '1';
process.env['REPORT_ARTIFACT_STORE'] = 'memory';
process.env['REPORT_DOWNLOAD_SIGNING_SECRET'] = 'report-audit-wiring-test-secret-0123456789';

interface RecordedQuery {
  sql: string;
  values: unknown[];
}

const recorded: RecordedQuery[] = [];
let failAppend = false;

function fakeClient() {
  return {
    query: async (sql: string, values: unknown[] = []) => {
      recorded.push({ sql, values });
      // PRC-M200: the row is appended through the SECURITY DEFINER keyed-chain functions.
      if (sql.includes('FROM audit_chain_lock_head(')) {
        return { rows: [{ head_seq: 0, head_hash: null }] };
      }
      if (sql.includes('FROM audit_chain_append(')) {
        if (failAppend) throw new Error('audit store unavailable (test)');
        return { rows: [{ chain_seq: 1, prev_hash: null }] };
      }
      return { rows: [] };
    },
    release: () => undefined,
  };
}

const fakePool = { connect: async () => fakeClient(), query: fakeClient().query };

// Only the gateway's durable domain audit writer (domain-audit-sink.ts) sees the fake pool.
// Every other boot-time caller keeps the in-memory path, so buildApp does not query it.
vi.mock('@proctira/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/database')>();
  return {
    ...actual,
    getSharedPgPool: () => (new Error().stack?.includes('domain-audit-sink') ? fakePool : null),
  };
});

const { buildApp } = await import('./app.js');

interface ReportAuditRow {
  tenantId: unknown;
  entityType: unknown;
  entityId: unknown;
  operation: unknown;
  userId: unknown;
  userName: unknown;
  metadata: Record<string, unknown>;
  raw: string;
}

/** `audit_chain_append(tenant, id, entity_type, entity_id, operation, user_id, user_name, …)`. */
function reportAuditRows(): ReportAuditRow[] {
  return recorded
    .filter((q) => q.sql.includes('FROM audit_chain_append('))
    .map((q) => ({
      tenantId: q.values[0],
      entityType: q.values[2],
      entityId: q.values[3],
      operation: q.values[4],
      userId: q.values[5],
      userName: q.values[6],
      metadata: JSON.parse(String(q.values[11] ?? '{}')) as Record<string, unknown>,
      raw: JSON.stringify(q.values),
    }))
    .filter((row) => String(row.metadata.regulated ?? '').startsWith('report.'));
}

const ADMIN = { sub: 'report-admin-a', roles: ['admin'] };
const OTHER_ADMIN = { sub: 'report-admin-b', roles: ['admin'], tenantId: OTHER_TENANT_ID };

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ config: createTestConfig() });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
});

afterEach(() => {
  recorded.length = 0;
  failAppend = false;
});

async function generate(): Promise<{ artifactId: string; downloadPath: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/reports/generate',
    headers: authHeaders(app, ADMIN),
    payload: { reportKey: 'students_roster', format: 'CSV' },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as { artifactId: string; downloadUrl: string };
  return {
    artifactId: body.artifactId,
    downloadPath:
      new URL(body.downloadUrl, 'http://x').pathname + new URL(body.downloadUrl, 'http://x').search,
  };
}

describe('UAT-SEC-001 report catalogue durable audit (gateway mount)', () => {
  it('generate appends exactly one report.generate row for the verified tenant and actor', async () => {
    const { artifactId } = await generate();
    const rows = reportAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TEST_TENANT_ID,
      entityType: 'report_artifact',
      entityId: artifactId,
      operation: 'CREATE',
      userId: ADMIN.sub,
      userName: ADMIN.sub,
    });
    expect(rows[0]!.metadata).toEqual({
      reportKey: 'students_roster',
      format: 'csv',
      runId: expect.any(String),
      regulated: 'report.generate',
      action: 'generate',
    });
  });

  it('a successful download appends exactly one report.download read row', async () => {
    const { artifactId, downloadPath } = await generate();
    recorded.length = 0;
    const res = await app.inject({
      method: 'GET',
      url: downloadPath,
      headers: authHeaders(app, ADMIN),
    });
    expect(res.statusCode).toBe(200);
    const rows = reportAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TEST_TENANT_ID,
      entityType: 'report_artifact',
      entityId: artifactId,
      operation: 'CREATE',
      userId: ADMIN.sub,
    });
    expect(rows[0]!.metadata).toEqual({
      reportKey: 'students_roster',
      format: 'csv',
      read: true,
      regulated: 'report.download',
      action: 'download',
    });
  });

  it.each([
    ['a forged token', '?token=9999999999.forged', 'token_invalid'],
    ['no token', '', 'token_missing'],
  ])(
    'a download with %s is denied and appends one report.download.denied row',
    async (_label, query, reason) => {
      const { artifactId } = await generate();
      recorded.length = 0;
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/artifacts/${artifactId}/download${query}`,
        headers: authHeaders(app, ADMIN),
      });
      expect(res.statusCode).toBe(403);
      const rows = reportAuditRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        tenantId: TEST_TENANT_ID,
        entityType: 'report_artifact',
        entityId: artifactId,
        operation: 'CREATE',
        userId: ADMIN.sub,
      });
      expect(rows[0]!.metadata).toEqual({
        reason,
        read: true,
        regulated: 'report.download.denied',
        action: 'download.denied',
      });
    },
  );

  it('a cross-tenant replay is audited under the caller tenant only, even with a spoofed tenant header', async () => {
    const { artifactId, downloadPath } = await generate();
    recorded.length = 0;
    const res = await app.inject({
      method: 'GET',
      url: downloadPath,
      // Verified principal is tenant B; the client header claims tenant A.
      headers: { ...authHeaders(app, OTHER_ADMIN), 'x-tenant-id': TEST_TENANT_ID },
    });
    expect(res.statusCode).toBe(403);
    // The gateway resolves tenant B from the verified token, the tenant-scoped lookup misses and
    // the denial is recorded under tenant B with nothing from tenant A's artifact row.
    const rows = reportAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: OTHER_TENANT_ID,
      entityType: 'report_artifact',
      entityId: artifactId,
      operation: 'CREATE',
      userId: OTHER_ADMIN.sub,
    });
    expect(rows[0]!.metadata).toEqual({
      reason: 'artifact_not_found',
      read: true,
      regulated: 'report.download.denied',
      action: 'download.denied',
    });
    expect(rows[0]!.raw).not.toContain(TEST_TENANT_ID);
    expect(rows[0]!.raw).not.toContain(ADMIN.sub);
    expect(rows[0]!.raw).not.toContain('students_roster');
  });

  it('schedule-create appends one report.schedule.create row without recipients', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/reports/schedules',
      headers: authHeaders(app, ADMIN),
      payload: {
        reportKey: 'students_roster',
        format: 'CSV',
        cadence: 'weekly',
        hour: 6,
        recipients: ['head@school.example'],
      },
    });
    expect(res.statusCode).toBe(201);
    const scheduleId = (res.json() as { id: string }).id;
    const rows = reportAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TEST_TENANT_ID,
      entityType: 'report_schedule',
      entityId: scheduleId,
      userId: ADMIN.sub,
    });
    expect(rows[0]!.metadata).toMatchObject({
      regulated: 'report.schedule.create',
      reportKey: 'students_roster',
    });
    expect(rows[0]!.raw).not.toContain('head@school.example');
  });

  it('an audit store failure does not change the download or denial response', async () => {
    const { downloadPath, artifactId } = await generate();
    failAppend = true;
    const ok = await app.inject({
      method: 'GET',
      url: downloadPath,
      headers: authHeaders(app, ADMIN),
    });
    expect(ok.statusCode).toBe(200);
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/reports/artifacts/${artifactId}/download?token=9999999999.forged`,
      headers: authHeaders(app, ADMIN),
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({
      code: 'FORBIDDEN',
      message: 'This download link is not valid for your account',
      statusCode: 403,
    });
    // The writes were attempted (so the failure path was exercised), not skipped.
    expect(
      recorded.filter((q) => q.sql.includes('FROM audit_chain_append(')).length,
    ).toBeGreaterThan(0);
  });
});
