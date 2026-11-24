/**
 * PRC-M027: SCIM deprovisioning revokes the user's sessions. The directory
 * record and the login identity are linked by tenant + email; the gateway
 * refuses the subject's tokens while the record is suspended, and only tokens
 * issued before the deprovision after it is reprovisioned.
 */
import { MemorySubjectSessionRevocationStore } from '@proctira/backend-auth';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440001';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const EMAIL = 'ann.teacher@school.org';

function config(): GatewayConfig {
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

describe('SCIM deprovision revokes sessions (PRC-M027)', () => {
  let app: FastifyInstance;
  const revocation = new MemorySubjectSessionRevocationStore();
  const scimTokens = new Map<string, string>();
  let seq = 0;

  const bearer = (input: {
    email: string;
    tenantId?: string;
    roleId?: string;
    iatOffsetSeconds?: number;
  }) => {
    seq += 1;
    const tenantId = input.tenantId ?? TENANT_A;
    const roleId = input.roleId ?? 'teacher';
    return `Bearer ${app.jwt.sign({
      sub: `${roleId}-${seq}`,
      tenantId,
      email: input.email,
      displayName: roleId,
      roles: [{ roleId, roleName: roleId, areaId: null }],
      areas: [],
      institutions: [],
      jti: `jti-m027-${seq}`,
      sessionId: `session-m027-${seq}`,
      ...(input.iatOffsetSeconds !== undefined
        ? { iat: Math.floor(Date.now() / 1000) + input.iatOffsetSeconds }
        : {}),
    } as never)}`;
  };
  const scim = (tenantId = TENANT_A) => ({
    authorization: `Bearer ${scimTokens.get(tenantId)}`,
    'content-type': 'application/scim+json',
  });
  const services = (authorization: string) =>
    app.inject({ method: 'GET', url: '/api/v1/services', headers: { authorization } });
  const provision = async (tenantId: string, userName: string) => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/scim/v2/Users',
      headers: scim(tenantId),
      payload: { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName },
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().id as string;
  };
  const setActive = (tenantId: string, id: string, active: boolean) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/scim/v2/Users/${id}`,
      headers: scim(tenantId),
      payload: { schemas: [PATCH], Operations: [{ op: 'replace', path: 'active', value: active }] },
    });

  beforeAll(async () => {
    app = await buildApp({ config: config(), subjectSessionRevocationStore: revocation });
    await app.ready();
    for (const tenantId of [TENANT_A, TENANT_B]) {
      const issued = await app.inject({
        method: 'POST',
        url: '/api/v1/tenant/scim-token',
        headers: {
          authorization: bearer({ email: 'admin@school.org', tenantId, roleId: 'admin' }),
        },
      });
      expect(issued.statusCode, issued.body).toBe(201);
      scimTokens.set(tenantId, (issued.json() as { token: string }).token);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('PATCH active=false refuses live and later tokens; reprovision keeps old tokens dead', async () => {
    const id = await provision(TENANT_A, 'Ann.Teacher@school.org');
    const live = bearer({ email: EMAIL });
    const colleague = bearer({ email: 'bob@school.org' });
    const otherTenant = bearer({ email: EMAIL, tenantId: TENANT_B });
    expect((await services(live)).statusCode).toBe(200);

    const off = await setActive(TENANT_A, id, false);
    expect(off.statusCode, off.body).toBe(200);
    const refused = await services(live);
    expect(refused.statusCode).toBe(401);
    expect(refused.json().code).toBe('SESSION_REVOKED');
    // A token minted later (for example by a refresh) is refused while suspended.
    expect(
      (await services(bearer({ email: EMAIL.toUpperCase(), iatOffsetSeconds: 5 }))).statusCode,
    ).toBe(401);
    // Other users of the tenant, and the same email in another tenant, keep their sessions.
    expect((await services(colleague)).statusCode).toBe(200);
    expect((await services(otherTenant)).statusCode).toBe(200);

    const on = await setActive(TENANT_A, id, true);
    expect(on.statusCode, on.body).toBe(200);
    expect((await services(live)).statusCode).toBe(401);
    expect((await services(bearer({ email: EMAIL, iatOffsetSeconds: 5 }))).statusCode).toBe(200);
  });

  it('DELETE deprovisions and revokes the sessions', async () => {
    const id = await provision(TENANT_A, 'carol@school.org');
    const live = bearer({ email: 'carol@school.org' });
    expect((await services(live)).statusCode).toBe(200);
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/scim/v2/Users/${id}`,
      headers: scim(),
    });
    expect(deleted.statusCode).toBe(204);
    expect((await services(live)).statusCode).toBe(401);
    expect(
      (await services(bearer({ email: 'carol@school.org', iatOffsetSeconds: 5 }))).statusCode,
    ).toBe(401);
  });

  it('fails closed (503) when the revocation store is unavailable', async () => {
    const original = revocation.subjectRevocation.bind(revocation);
    revocation.subjectRevocation = () => Promise.reject(new Error('redis down'));
    try {
      const res = await services(bearer({ email: 'dave@school.org' }));
      expect(res.statusCode).toBe(503);
    } finally {
      revocation.subjectRevocation = original;
    }
  });
});
