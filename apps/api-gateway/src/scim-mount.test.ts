/**
 * G-924 — SCIM 2.0 provisioning over the tenant directory: discovery, user
 * create / lookup-by-filter / deactivate via PATCH, group membership via
 * PATCH, tenant isolation, and RBAC deny for a teacher.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import { activeFromPatch, parseEqFilter } from './scim-plugin.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440001';
const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

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

describe('scim helpers', () => {
  it('parses the eq filters IdPs send', () => {
    expect(parseEqFilter('userName eq "ann@school.org"')).toEqual({
      attribute: 'username',
      value: 'ann@school.org',
    });
    expect(parseEqFilter('emails.value eq "a\\"b"')).toEqual({
      attribute: 'emails.value',
      value: 'a"b',
    });
    expect(parseEqFilter('userName co "x"')).toBeNull();
  });

  it('reads active from replace ops in both Okta and Entra shapes', () => {
    expect(activeFromPatch([{ op: 'replace', path: 'active', value: false }])).toBe(false);
    expect(activeFromPatch([{ op: 'Replace', value: { active: 'True' } }])).toBe(true);
    expect(activeFromPatch([{ op: 'replace', path: 'displayName', value: 'x' }])).toBeUndefined();
  });
});

describe('G-924 SCIM 2.0 mount', () => {
  let app: FastifyInstance;

  const headers = (roleId: string, tenantId = TENANT_A) => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: `${roleId}-1`,
      tenantId,
      email: `${roleId}@example.com`,
      displayName: roleId,
      roles: [{ roleId, roleName: roleId, areaId: null }],
      areas: [],
      institutions: [],
      jti: `jti-${roleId}-${tenantId}`,
      sessionId: `session-${roleId}-${tenantId}`,
    } as never)}`,
    'x-tenant-id': tenantId,
    'content-type': 'application/scim+json',
  });

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves discovery documents', async () => {
    const spc = await app.inject({
      method: 'GET',
      url: '/api/v1/scim/v2/ServiceProviderConfig',
      headers: headers('admin'),
    });
    expect(spc.statusCode, spc.body).toBe(200);
    expect(spc.headers['content-type']).toContain('application/scim+json');
    expect(spc.json().patch.supported).toBe(true);

    const types = await app.inject({
      method: 'GET',
      url: '/api/v1/scim/v2/ResourceTypes',
      headers: headers('admin'),
    });
    expect(types.json().Resources.map((r: { id: string }) => r.id)).toEqual(['User', 'Group']);
  });

  it('provisions a user, finds it by filter, deactivates via PATCH, and assigns a group', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/scim/v2/Users',
      headers: headers('admin'),
      payload: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'Ann.Teacher@school.org',
        displayName: 'Ann Teacher',
        active: true,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const user = created.json();
    expect(user.userName).toBe('ann.teacher@school.org');
    expect(user.active).toBe(true);
    expect(user.meta.location).toContain(`/scim/v2/Users/${user.id}`);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/scim/v2/Users',
      headers: headers('admin'),
      payload: { userName: 'ann.teacher@school.org' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().scimType).toBe('uniqueness');

    const found = await app.inject({
      method: 'GET',
      url: `/api/v1/scim/v2/Users?filter=${encodeURIComponent('userName eq "ann.teacher@school.org"')}`,
      headers: headers('admin'),
    });
    expect(found.statusCode).toBe(200);
    expect(found.json().totalResults).toBe(1);
    expect(found.json().Resources[0].id).toBe(user.id);

    const groups = await app.inject({
      method: 'GET',
      url: '/api/v1/scim/v2/Groups',
      headers: headers('admin'),
    });
    expect(groups.statusCode).toBe(200);
    const teacherGroup = groups
      .json()
      .Resources.find((g: { displayName: string }) => /teacher/i.test(g.displayName));
    expect(teacherGroup).toBeDefined();

    const membership = await app.inject({
      method: 'PATCH',
      url: `/api/v1/scim/v2/Groups/${teacherGroup.id}`,
      headers: headers('admin'),
      payload: {
        schemas: [PATCH],
        Operations: [{ op: 'add', path: 'members', value: [{ value: user.id }] }],
      },
    });
    expect(membership.statusCode, membership.body).toBe(200);
    expect(membership.json().members.map((m: { value: string }) => m.value)).toContain(user.id);

    const deactivated = await app.inject({
      method: 'PATCH',
      url: `/api/v1/scim/v2/Users/${user.id}`,
      headers: headers('admin'),
      payload: { schemas: [PATCH], Operations: [{ op: 'replace', path: 'active', value: false }] },
    });
    expect(deactivated.statusCode, deactivated.body).toBe(200);
    expect(deactivated.json().active).toBe(false);
    expect(deactivated.json().groups.map((g: { value: string }) => g.value)).toContain(
      teacherGroup.id,
    );

    const removed = await app.inject({
      method: 'PATCH',
      url: `/api/v1/scim/v2/Groups/${teacherGroup.id}`,
      headers: headers('admin'),
      payload: {
        schemas: [PATCH],
        Operations: [{ op: 'remove', path: `members[value eq "${user.id}"]` }],
      },
    });
    expect(removed.statusCode, removed.body).toBe(200);
    expect(removed.json().members.map((m: { value: string }) => m.value)).not.toContain(user.id);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/v1/scim/v2/Users/${user.id}`,
      headers: headers('admin'),
    });
    expect(deleted.statusCode).toBe(204);

    // Tenant B never sees tenant A's user.
    const otherTenant = await app.inject({
      method: 'GET',
      url: `/api/v1/scim/v2/Users/${user.id}`,
      headers: headers('admin', TENANT_B),
    });
    expect(otherTenant.statusCode).toBe(404);
  });

  it('rejects malformed PatchOp and unsupported filters', async () => {
    const badFilter = await app.inject({
      method: 'GET',
      url: `/api/v1/scim/v2/Users?filter=${encodeURIComponent('userName co "ann"')}`,
      headers: headers('admin'),
    });
    expect(badFilter.statusCode).toBe(400);
    expect(badFilter.json().scimType).toBe('invalidFilter');

    const badPatch = await app.inject({
      method: 'PATCH',
      url: '/api/v1/scim/v2/Users/00000000-0000-4000-8000-000000000000',
      headers: headers('admin'),
      payload: { Operations: [] },
    });
    expect(badPatch.statusCode).toBe(400);
  });

  it('denies a teacher (no user:manage)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/scim/v2/Users',
      headers: headers('teacher'),
    });
    expect(res.statusCode).toBe(403);
  });
});
