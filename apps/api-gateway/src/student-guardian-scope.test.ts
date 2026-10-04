/**
 * S16-01 / PRC-C010 / PRC-L366 — through the real gateway (JWT + tenant + RBAC + studentPlugin
 * + parent-portal child-link binding), a parent/guardian/student must not list, search, or read
 * students outside their linked children, in their own tenant or another one.
 */
import { randomUUID } from 'node:crypto';

import { createParentPortalRepository } from '@proctira/backend-parent-portal';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440a01';
const TENANT_B = '550e8400-e29b-41d4-a716-446655440b02';
const PARENT_A1 = 'parent-family-1';
const PARENT_A2 = 'parent-family-2';

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

describe('S16-01 guardian/parent student scoping (gateway)', () => {
  let app: FastifyInstance;
  let childFamily1: string;
  let childFamily2: string;
  let studentTenantB: string;

  function bearer(sub: string, roleId: string, tenantId: string): string {
    return app.jwt.sign({
      sub,
      tenantId,
      email: `${sub}@example.com`,
      displayName: sub,
      roles: [{ roleId, roleName: roleId, areaId: 'root' }],
      areas: [],
      institutions: [],
      jti: `jti-s1601-${sub}-${tenantId}`,
      sessionId: `session-s1601-${sub}-${tenantId}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  function get(url: string, token: string, tenantId: string) {
    return app.inject({
      method: 'GET',
      url,
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': tenantId },
    });
  }

  async function createStudent(tenantId: string, firstName: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${bearer('admin-1', 'admin', tenantId)}`,
        'x-tenant-id': tenantId,
        'content-type': 'application/json',
      },
      payload: { firstName, lastName: 'Scope', dateOfBirth: '2012-03-04', gender: 'female' },
    });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  }

  async function link(tenantId: string, parentUserId: string, studentId: string): Promise<void> {
    await createParentPortalRepository().createChildLink({
      id: randomUUID(),
      tenantId,
      parentUserId,
      studentId,
      relationship: 'mother',
      status: 'active',
      isPrimary: true,
      canConsentMedical: true,
      canViewFees: true,
      householdId: null,
    });
  }

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
    childFamily1 = await createStudent(TENANT_A, 'FamilyOne');
    childFamily2 = await createStudent(TENANT_A, 'FamilyTwo');
    studentTenantB = await createStudent(TENANT_B, 'OtherTenant');
    await link(TENANT_A, PARENT_A1, childFamily1);
    await link(TENANT_A, PARENT_A2, childFamily2);
  });
  afterAll(async () => {
    await app.close();
  });

  for (const role of ['parent', 'guardian', 'student']) {
    it(`${role} cannot list the register (403)`, async () => {
      const res = await get('/api/v1/students', bearer(PARENT_A1, role, TENANT_A), TENANT_A);
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('FamilyTwo');
    });
    it(`${role} cannot search the register (403)`, async () => {
      const res = await get(
        '/api/v1/students/search?q=Family',
        bearer(PARENT_A1, role, TENANT_A),
        TENANT_A,
      );
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('FamilyTwo');
    });
  }

  for (const role of ['parent', 'guardian']) {
    it(`${role} reads their own linked child (200)`, async () => {
      const res = await get(
        `/api/v1/students/${childFamily1}`,
        bearer(PARENT_A1, role, TENANT_A),
        TENANT_A,
      );
      expect(res.statusCode).toBe(200);
      expect(res.json().id).toBe(childFamily1);
    });

    it(`${role} gets 404 for another family's child in the same tenant`, async () => {
      const res = await get(
        `/api/v1/students/${childFamily2}`,
        bearer(PARENT_A1, role, TENANT_A),
        TENANT_A,
      );
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('FamilyTwo');
    });

    it(`${role} gets 404 for a student in another tenant`, async () => {
      const res = await get(
        `/api/v1/students/${studentTenantB}`,
        bearer(PARENT_A1, role, TENANT_A),
        TENANT_A,
      );
      expect(res.statusCode).toBe(404);
    });

    it(`${role} link in tenant A grants nothing when calling as tenant B (404)`, async () => {
      const res = await get(
        `/api/v1/students/${childFamily1}`,
        bearer(PARENT_A1, role, TENANT_B),
        TENANT_B,
      );
      expect(res.statusCode).toBe(404);
    });
  }

  it('staff allowlist: teacher lists only own-tenant students', async () => {
    const res = await get('/api/v1/students', bearer('teacher-1', 'teacher', TENANT_A), TENANT_A);
    expect(res.statusCode).toBe(200);
    const ids = (res.json().data as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([childFamily1, childFamily2]));
    expect(ids).not.toContain(studentTenantB);
  });

  it('staff cross-tenant read by id is 404', async () => {
    const res = await get(
      `/api/v1/students/${studentTenantB}`,
      bearer('admin-1', 'admin', TENANT_A),
      TENANT_A,
    );
    expect(res.statusCode).toBe(404);
  });

  it('an unknown role is denied list and read (403)', async () => {
    const token = bearer('x-1', 'librarian-unknown', TENANT_A);
    expect((await get('/api/v1/students', token, TENANT_A)).statusCode).toBe(403);
    expect((await get(`/api/v1/students/${childFamily1}`, token, TENANT_A)).statusCode).toBe(403);
  });
});
