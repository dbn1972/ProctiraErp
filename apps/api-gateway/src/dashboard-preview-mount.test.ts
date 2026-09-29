/**
 * Task 9.2 (`principal-dashboard-parity`, Req 6.13) — `dashboard-preview`
 * audit-anchor mount.
 *
 * Mirrors `audit-mount.test.ts`'s exact pattern (G-105): POST/DELETE
 * `/api/v1/dashboard-preview` by an admin/principal-role JWT, and assert
 * `app.auditService.queryAuditLogs(...)` shows a new row afterward with the
 * right `operation`/`entityType`/`userId`. Also asserts a teacher-role JWT
 * gets 403 on the same routes — `dashboard-preview:manage` (Task 6,
 * DEFAULT_ROLES) is only granted to `admin`/`principal`.
 *
 * Task 9.3 (Req 6.12, 6.13) — the successful-mutation assertions below check
 * an *exact* row count (`beforeCount + 1`), not merely "at least one more".
 * This is safe because the gateway's global mutation-audit `onSend` hook
 * (`app.ts`) runs once per response and calls `auditService.recordAudit()`
 * exactly once (`persistMutationAudit`, `./mutation-audit.ts`); the
 * `dashboard-preview` POST/DELETE handlers themselves (`domain-plugins.ts`)
 * make no nested mutating calls, so there is no double-audit path for a
 * single request. The 403 tests assert the converse: `onSend` explicitly
 * skips `reply.statusCode === 401 || 403` (`app.ts`), so an unauthorized
 * attempt must add zero rows — proving Task 9.3's "unauthorized caller
 * cannot set the state" holds at the audit layer too, not just the response
 * code.
 *
 * These routes carry no domain state of their own (see `domain-plugins.ts`'s
 * `dashboard-preview` registrar doc comment) — they exist solely so the
 * gateway's global mutation-audit `onSend` hook (`app.ts`) has a real
 * mutating `/api/v1/*` request to audit on behalf of `apps/web`'s
 * `Dashboard-Preview-State` cookie set/clear (Task 9.1), which cannot write
 * to `audit_log_entries` directly (no `@proctira/database` dependency).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

function createTestJwtPayload(overrides?: Record<string, unknown>) {
  return {
    sub: 'user-dashpreview',
    tenantId: TENANT_ID,
    email: 'test@example.com',
    displayName: 'Test User',
    roles: [
      {
        roleId: 'admin',
        roleName: 'Administrator',
        areaId: 'root',
      },
    ],
    areas: [],
    institutions: [],
    jti: 'test-jti-dashpreview',
    sessionId: 'test-session-dashpreview',
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: {
      windowMs: 60000,
      maxRequests: 1000,
    },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: {
      baseDomain: 'proctira.org',
      headerName: 'x-tenant-id',
    },
    services: {
      auth: {
        prefix: '/auth',
        target: 'http://127.0.0.1:1',
        healthCheck: '/health',
      },
    },
  };
}

describe('Task 9.2 dashboard-preview mount', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('records an audit row on a successful POST /api/v1/dashboard-preview (admin)', async () => {
    const before = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });
    const beforeCount = before.data.length;

    const token = app.jwt.sign(createTestJwtPayload());

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboard-preview',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_ID,
        'content-type': 'application/json',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(200);

    const after = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });

    // Task 9.3: exactly one audit row per set, not merely "at least one".
    expect(after.data.length).toBe(beforeCount + 1);
    const latest = after.data[0]!;
    expect(latest.operation).toBe('CREATE');
    expect(latest.userId).toBe('user-dashpreview');
    expect(latest.entityType).toBe('dashboard-preview');
  });

  it('records an audit row on a successful DELETE /api/v1/dashboard-preview (principal)', async () => {
    const before = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });
    const beforeCount = before.data.length;

    const token = app.jwt.sign(
      createTestJwtPayload({
        sub: 'user-dashpreview-principal',
        roles: [{ roleId: 'principal', roleName: 'Principal', areaId: 'root' }],
      }),
    );

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/dashboard-preview',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_ID,
      },
    });

    expect(response.statusCode).toBe(204);

    const after = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });

    // Task 9.3: exactly one audit row per clear, not merely "at least one".
    expect(after.data.length).toBe(beforeCount + 1);
    const latest = after.data[0]!;
    expect(latest.operation).toBe('DELETE');
    expect(latest.userId).toBe('user-dashpreview-principal');
    expect(latest.entityType).toBe('dashboard-preview');
  });

  it('returns 403 for a teacher-role JWT on POST /api/v1/dashboard-preview, and writes no audit row', async () => {
    const before = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });
    const beforeCount = before.data.length;

    const token = app.jwt.sign(
      createTestJwtPayload({
        sub: 'user-dashpreview-teacher',
        roles: [{ roleId: 'teacher', roleName: 'Teacher', areaId: 'root' }],
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/dashboard-preview',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_ID,
        'content-type': 'application/json',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');

    // Task 9.3: an unauthorized caller cannot set the state — and the
    // gateway's mutation-audit hook explicitly skips 401/403 responses
    // (`app.ts`), so the rejected attempt must add zero audit rows.
    const after = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });
    expect(after.data.length).toBe(beforeCount);
  });

  it('returns 403 for a teacher-role JWT on DELETE /api/v1/dashboard-preview, and writes no audit row', async () => {
    const before = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });
    const beforeCount = before.data.length;

    const token = app.jwt.sign(
      createTestJwtPayload({
        sub: 'user-dashpreview-teacher-2',
        roles: [{ roleId: 'teacher', roleName: 'Teacher', areaId: 'root' }],
      }),
    );

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/dashboard-preview',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_ID,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('FORBIDDEN');

    // Task 9.3: same converse check for DELETE.
    const after = await app.auditService.queryAuditLogs({
      tenantId: TENANT_ID,
      page: 1,
      pageSize: 100,
    });
    expect(after.data.length).toBe(beforeCount);
  });
});
