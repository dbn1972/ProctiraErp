/**
 * PRC-H111 — `/api/v1/workflow-engine/cases` is gated by the dedicated `case`
 * resource (not `workflow`), and per-case institution/assignee scope is
 * enforced end-to-end through the gateway with real JWTs.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import { resolveExactMutatingAuthz } from './mutating-route-authz.js';
import { createGatewayRbacRegistry, resourceForApiPath } from './rbac-registry.js';

delete process.env['DATABASE_URL'];

const TENANT_ID = '550e8400-e29b-41d4-a716-446655441111';
const INST_A = '11111111-1111-4111-8111-111111111111';
const INST_B = '22222222-2222-4222-8222-222222222222';

function signToken(
  app: FastifyInstance,
  roleId: string,
  opts: { sub?: string; institutions?: string[]; roleName?: string } = {},
): string {
  const sub = opts.sub ?? `user-${roleId}`;
  return app.jwt.sign({
    sub,
    tenantId: TENANT_ID,
    email: `${sub}@example.com`,
    displayName: sub,
    roles: [{ roleId, roleName: opts.roleName ?? `Display ${roleId}`, areaId: 'root' }],
    areas: [],
    institutions: opts.institutions ?? [],
    jti: `jti-${sub}`,
    sessionId: `session-${sub}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 1000 },
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
    tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  };
}

const CASES = '/api/v1/workflow-engine/cases';

describe('PRC-H111 case RBAC mapping', () => {
  it('maps case paths to the dedicated case resource', () => {
    expect(resourceForApiPath(CASES)).toBe('case');
    expect(resourceForApiPath(`${CASES}/abc`)).toBe('case');
    expect(resourceForApiPath('/api/v1/workflow-engine/instances')).toBe('workflow');
    expect(resolveExactMutatingAuthz('PUT', `${CASES}/abc`)?.resource).toBe('case');
    expect(resolveExactMutatingAuthz('POST', `${CASES}/abc/resolve`)?.resource).toBe('case');
    expect(resolveExactMutatingAuthz('POST', '/api/v1/workflow-engine/instances')?.resource).toBe(
      'workflow',
    );
  });

  it('grants case access to admin/principal/counsellor/discipline_officer only', () => {
    const registry = createGatewayRbacRegistry();
    for (const roleId of ['admin', 'principal', 'counsellor', 'discipline_officer']) {
      expect(registry.roleHasPermission(roleId, 'case', 'read')).toBe(true);
    }
    for (const roleId of ['teacher', 'staff', 'guardian', 'parent', 'student', 'nurse']) {
      expect(registry.roleHasPermission(roleId, 'case', 'read')).toBe(false);
      expect(registry.roleHasPermission(roleId, 'case', 'update')).toBe(false);
    }
    // Teachers still hold workflow:read — that alone must no longer expose cases.
    expect(registry.roleHasPermission('teacher', 'workflow', 'read')).toBe(true);
  });
});

describe('PRC-H111 case access through the gateway', () => {
  let app: FastifyInstance;
  const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_ID });
  let caseA: string;
  let caseB: string;
  let caseAssigned: string;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
    const admin = auth(signToken(app, 'admin'));
    const create = async (institutionId: string, assignedTo?: string) => {
      const res = await app.inject({
        method: 'POST',
        url: CASES,
        headers: admin,
        payload: {
          type: 'counselling',
          title: 'Case',
          description: 'Sensitive',
          entityType: 'student',
          entityId: 'stu-1',
          institutionId,
          ...(assignedTo ? { assignedTo } : {}),
        },
      });
      expect(res.statusCode).toBe(201);
      return (res.json() as { id: string }).id;
    };
    caseA = await create(INST_A);
    caseB = await create(INST_B);
    caseAssigned = await create(INST_B, 'counsellor-a');
  });

  afterAll(async () => {
    await app.close();
  });

  it('teacher with workflow:read gets 403 on case list, read and update', async () => {
    const teacher = auth(signToken(app, 'teacher', { institutions: [INST_A] }));
    expect((await app.inject({ method: 'GET', url: CASES, headers: teacher })).statusCode).toBe(
      403,
    );
    expect(
      (await app.inject({ method: 'GET', url: `${CASES}/${caseA}`, headers: teacher })).statusCode,
    ).toBe(403);
    const put = await app.inject({
      method: 'PUT',
      url: `${CASES}/${caseA}`,
      headers: teacher,
      payload: { status: 'in_progress' },
    });
    expect(put.statusCode).toBe(403);
    // Teachers keep workflow-engine access for definitions/instances.
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/workflow-engine', headers: teacher }))
        .statusCode,
    ).toBe(200);
  });

  it('non-counsellor staff gets 403 on counselling cases', async () => {
    const staff = auth(signToken(app, 'staff', { institutions: [INST_A] }));
    expect((await app.inject({ method: 'GET', url: CASES, headers: staff })).statusCode).toBe(403);
  });

  it('a custom role displayed as "Counsellor" is not trusted (roleId only)', async () => {
    const mallory = auth(
      signToken(app, 'custom-role-1', { institutions: [INST_A], roleName: 'counsellor' }),
    );
    expect((await app.inject({ method: 'GET', url: CASES, headers: mallory })).statusCode).toBe(
      403,
    );
  });

  it('counsellor scoped to institution A sees A cases and own assignment, not B', async () => {
    const counsellor = auth(
      signToken(app, 'counsellor', { sub: 'counsellor-a', institutions: [INST_A] }),
    );
    const list = await app.inject({ method: 'GET', url: CASES, headers: counsellor });
    expect(list.statusCode).toBe(200);
    const ids = (list.json() as { data: Array<{ id: string }> }).data.map((c) => c.id).sort();
    expect(ids).toEqual([caseA, caseAssigned].sort());
    expect(
      (await app.inject({ method: 'GET', url: `${CASES}/${caseB}`, headers: counsellor }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `${CASES}/${caseAssigned}`, headers: counsellor }))
        .statusCode,
    ).toBe(200);
  });

  it('principal of institution B sees only B cases; tenant admin sees all', async () => {
    const principal = auth(signToken(app, 'principal', { institutions: [INST_B] }));
    const pList = await app.inject({ method: 'GET', url: CASES, headers: principal });
    expect(pList.statusCode).toBe(200);
    expect((pList.json() as { data: Array<{ id: string }> }).data.map((c) => c.id).sort()).toEqual(
      [caseB, caseAssigned].sort(),
    );

    const admin = auth(signToken(app, 'admin'));
    const aList = await app.inject({ method: 'GET', url: CASES, headers: admin });
    expect((aList.json() as { meta: { totalItems: number } }).meta.totalItems).toBe(3);
  });
});
