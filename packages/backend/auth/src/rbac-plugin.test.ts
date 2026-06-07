/**
 * Unit tests for the RBAC Fastify Plugin.
 *
 * Tests the `requirePermission` preHandler decorator for route-level permission checks.
 */

import Fastify from 'fastify';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { AuthUser } from '@proctira/auth';
import {
  RbacPermissionRegistry,
  InMemoryAreaHierarchyResolver,
  DEFAULT_ROLES,
} from '@proctira/auth';
import type { AreaNode } from '@proctira/auth';

import { authPlugin } from './auth-plugin.js';
import { rbacPlugin } from './rbac-plugin.js';
import { createAuthConfig } from '@proctira/auth';

/**
 * Test area hierarchy:
 *   country (level 0)
 *   ├── region-north (level 1)
 *   │   ├── district-a (level 2)
 *   │   └── district-b (level 2)
 *   └── region-south (level 1)
 *       └── district-c (level 2)
 */
const TEST_AREAS: AreaNode[] = [
  { id: 'country', parentId: null, level: 0, path: '/country' },
  { id: 'region-north', parentId: 'country', level: 1, path: '/country/region-north' },
  { id: 'region-south', parentId: 'country', level: 1, path: '/country/region-south' },
  { id: 'district-a', parentId: 'region-north', level: 2, path: '/country/region-north/district-a' },
  { id: 'district-b', parentId: 'region-north', level: 2, path: '/country/region-north/district-b' },
  { id: 'district-c', parentId: 'region-south', level: 2, path: '/country/region-south/district-c' },
];

const TEST_SECRET = 'test-secret-key-for-rbac-tests-minimum-32-chars';

function createTestApp() {
  const app = Fastify();
  const config = createAuthConfig({
    jwt: {
      secret: TEST_SECRET,
      issuer: 'test-issuer',
      audience: 'test-audience',
      accessTokenExpiresIn: 900,
    },
  });

  const registry = new RbacPermissionRegistry(DEFAULT_ROLES);
  const areaResolver = new InMemoryAreaHierarchyResolver(TEST_AREAS);

  return { app, config, registry, areaResolver };
}

function signToken(app: ReturnType<typeof Fastify>, payload: Record<string, unknown>) {
  return app.jwt.sign(payload);
}

describe('RBAC Fastify Plugin', () => {
  let app: ReturnType<typeof Fastify>;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('should return 401 when no auth token is provided', async () => {
    const { app: testApp, config, registry, areaResolver } = createTestApp();
    app = testApp;

    await app.register(authPlugin, { config });
    await app.register(rbacPlugin, { registry, areaResolver });

    app.get('/test', {
      preHandler: [app.authenticate, app.requirePermission('institution', 'read')],
    }, async () => ({ ok: true }));

    await app.ready();

    const response = await app.inject({
      method: 'GET',
      url: '/test',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('UNAUTHORIZED');
  });

  it('should return 403 when user lacks the required permission', async () => {
    const { app: testApp, config, registry, areaResolver } = createTestApp();
    app = testApp;

    await app.register(authPlugin, { config });
    await app.register(rbacPlugin, { registry, areaResolver });

    app.get('/institutions', {
      preHandler: [app.authenticate, app.requirePermission('institution', 'create')],
    }, async () => ({ ok: true }));

    await app.ready();

    // Teacher cannot create institutions
    const token = signToken(app, {
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'teacher@example.com',
      displayName: 'Teacher',
      roles: [{ roleId: 'teacher', roleName: 'Teacher', areaId: 'country' }],
      areas: [{ areaId: 'country', level: 0 }],
      institutions: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/institutions',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.code).toBe('FORBIDDEN');
  });

  it('should return 200 when user has the required permission', async () => {
    const { app: testApp, config, registry, areaResolver } = createTestApp();
    app = testApp;

    await app.register(authPlugin, { config });
    await app.register(rbacPlugin, { registry, areaResolver });

    app.get('/institutions', {
      preHandler: [app.authenticate, app.requirePermission('institution', 'read')],
    }, async () => ({ ok: true }));

    await app.ready();

    // Admin can read institutions
    const token = signToken(app, {
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@example.com',
      displayName: 'Admin',
      roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'country' }],
      areas: [{ areaId: 'country', level: 0 }],
      institutions: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/institutions',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
  });

  it('should enforce area scope from query params', async () => {
    const { app: testApp, config, registry, areaResolver } = createTestApp();
    app = testApp;

    await app.register(authPlugin, { config });
    await app.register(rbacPlugin, { registry, areaResolver });

    app.get('/institutions', {
      preHandler: [app.authenticate, app.requirePermission('institution', 'read')],
    }, async () => ({ ok: true }));

    await app.ready();

    // Admin scoped to region-north
    const token = signToken(app, {
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@example.com',
      displayName: 'Admin',
      roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'region-north' }],
      areas: [{ areaId: 'region-north', level: 1 }],
      institutions: [],
    });

    // Access resource in descendant area — should succeed
    const response1 = await app.inject({
      method: 'GET',
      url: '/institutions?areaId=district-a',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response1.statusCode).toBe(200);

    // Access resource in different branch — should fail
    const response2 = await app.inject({
      method: 'GET',
      url: '/institutions?areaId=district-c',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response2.statusCode).toBe(403);
  });

  it('should enforce area scope from route params', async () => {
    const { app: testApp, config, registry, areaResolver } = createTestApp();
    app = testApp;

    await app.register(authPlugin, { config });
    await app.register(rbacPlugin, { registry, areaResolver });

    app.get('/areas/:areaId/institutions', {
      preHandler: [app.authenticate, app.requirePermission('institution', 'read')],
    }, async () => ({ ok: true }));

    await app.ready();

    // Admin scoped to region-south
    const token = signToken(app, {
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@example.com',
      displayName: 'Admin',
      roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'region-south' }],
      areas: [{ areaId: 'region-south', level: 1 }],
      institutions: [],
    });

    // Access resource in descendant area — should succeed
    const response1 = await app.inject({
      method: 'GET',
      url: '/areas/district-c/institutions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response1.statusCode).toBe(200);

    // Access resource in different branch — should fail
    const response2 = await app.inject({
      method: 'GET',
      url: '/areas/district-a/institutions',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response2.statusCode).toBe(403);
  });

  it('should support custom resource context extractor', async () => {
    const { app: testApp, config, registry, areaResolver } = createTestApp();
    app = testApp;

    await app.register(authPlugin, { config });
    await app.register(rbacPlugin, { registry, areaResolver });

    // Custom extractor that reads areaId from a custom header
    const customExtractor = (request: { headers: Record<string, unknown> }) => {
      const areaId = request.headers['x-resource-area'] as string | undefined;
      return areaId ? { areaId } : undefined;
    };

    app.get('/custom', {
      preHandler: [
        app.authenticate,
        app.requirePermission('institution', 'read', customExtractor as any),
      ],
    }, async () => ({ ok: true }));

    await app.ready();

    const token = signToken(app, {
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'admin@example.com',
      displayName: 'Admin',
      roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'region-north' }],
      areas: [{ areaId: 'region-north', level: 1 }],
      institutions: [],
    });

    // Custom header with area in scope
    const response1 = await app.inject({
      method: 'GET',
      url: '/custom',
      headers: {
        authorization: `Bearer ${token}`,
        'x-resource-area': 'district-a',
      },
    });
    expect(response1.statusCode).toBe(200);

    // Custom header with area out of scope
    const response2 = await app.inject({
      method: 'GET',
      url: '/custom',
      headers: {
        authorization: `Bearer ${token}`,
        'x-resource-area': 'district-c',
      },
    });
    expect(response2.statusCode).toBe(403);
  });

  it('should allow access when no area context is present (permission-only check)', async () => {
    const { app: testApp, config, registry, areaResolver } = createTestApp();
    app = testApp;

    await app.register(authPlugin, { config });
    await app.register(rbacPlugin, { registry, areaResolver });

    app.get('/dashboard', {
      preHandler: [app.authenticate, app.requirePermission('institution', 'read')],
    }, async () => ({ ok: true }));

    await app.ready();

    // Teacher can read institutions (no area context needed for dashboard)
    const token = signToken(app, {
      sub: 'user-1',
      tenantId: 'tenant-1',
      email: 'teacher@example.com',
      displayName: 'Teacher',
      roles: [{ roleId: 'teacher', roleName: 'Teacher', areaId: 'district-a' }],
      areas: [{ areaId: 'district-a', level: 2 }],
      institutions: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/dashboard',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
  });

  it('should expose rbacRegistry and rbacAreaResolver on fastify instance', async () => {
    const { app: testApp, config, registry, areaResolver } = createTestApp();
    app = testApp;

    await app.register(authPlugin, { config });
    await app.register(rbacPlugin, { registry, areaResolver });

    await app.ready();

    expect(app.rbacRegistry).toBe(registry);
    expect(app.rbacAreaResolver).toBe(areaResolver);
  });
});
