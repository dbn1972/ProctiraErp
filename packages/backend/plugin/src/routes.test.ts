/**
 * Plugin Routes Integration Tests
 *
 * Tests the HTTP API layer for plugin CRUD operations.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { PluginService } from './plugin-service.js';
import { InMemoryPluginRepository } from './in-memory-repository.js';
import { registerPluginRoutes } from './routes.js';

let app: FastifyInstance;
let service: PluginService;

function validManifestBody() {
  return {
    manifest: {
      name: 'test-plugin',
      owner: 'proctira',
      version: '1.0.0',
      supportedProductVersions: '^2.0.0',
      requiredPermissions: ['read:students'],
      requiredExtensionPoints: ['after-create'],
      runtimeDependencies: [],
      tenantScopeBehavior: 'isolated',
      auditBehavior: 'Logs all operations',
    },
    description: 'A test plugin',
    category: 'workflow',
  };
}

beforeEach(async () => {
  app = Fastify();

  // Add tenant context decorator for testing
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId =
      (request.headers['x-tenant-id'] as string) || '';
  });

  const repository = new InMemoryPluginRepository();
  service = new PluginService(repository, { productVersion: '2.0.0' });

  await registerPluginRoutes(app, { pluginService: service });
  await app.ready();
});

describe('POST /plugins (register)', () => {
  it('should register a plugin and return 201', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/plugins',
      payload: validManifestBody(),
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe('test-plugin');
    expect(body.owner).toBe('proctira');
    expect(body.status).toBe('active');
    expect(body.id).toBeDefined();
  });

  it('should return 400 for invalid manifest', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/plugins',
      payload: { manifest: { name: '' } },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('should return 409 for duplicate plugin name', async () => {
    await app.inject({
      method: 'POST',
      url: '/plugins',
      payload: validManifestBody(),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/plugins',
      payload: validManifestBody(),
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('GET /plugins', () => {
  it('should list registered plugins', async () => {
    await app.inject({
      method: 'POST',
      url: '/plugins',
      payload: validManifestBody(),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/plugins',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(1);
  });
});

describe('GET /plugins/:pluginId', () => {
  it('should return a plugin by ID', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/plugins',
      payload: validManifestBody(),
    });
    const pluginId = createResponse.json().id;

    const response = await app.inject({
      method: 'GET',
      url: `/plugins/${pluginId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe(pluginId);
  });

  it('should return 404 for non-existent plugin', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/plugins/a0000000-0000-4000-a000-000000000000',
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('POST /plugins/install', () => {
  it('should install a plugin for a tenant', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/plugins',
      payload: validManifestBody(),
    });
    const pluginId = createResponse.json().id;

    const response = await app.inject({
      method: 'POST',
      url: '/plugins/install',
      headers: { 'x-tenant-id': 'tenant-1' },
      payload: {
        pluginId,
        consentedPermissions: ['read:students'],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.pluginId).toBe(pluginId);
    expect(body.tenantId).toBe('tenant-1');
    expect(body.status).toBe('installed');
  });

  it('should return 400 without tenant context', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/plugins/install',
      payload: {
        pluginId: 'a0000000-0000-4000-a000-000000000000',
        consentedPermissions: [],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe('TENANT_REQUIRED');
  });
});

describe('POST /plugins/installations/:installId/enable', () => {
  it('should enable an installed plugin', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/plugins',
      payload: validManifestBody(),
    });
    const pluginId = createResponse.json().id;

    const installResponse = await app.inject({
      method: 'POST',
      url: '/plugins/install',
      headers: { 'x-tenant-id': 'tenant-1' },
      payload: { pluginId, consentedPermissions: ['read:students'] },
    });
    const installId = installResponse.json().id;

    const response = await app.inject({
      method: 'POST',
      url: `/plugins/installations/${installId}/enable`,
      headers: { 'x-tenant-id': 'tenant-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('enabled');
  });
});

describe('POST /plugins/installations/:installId/disable', () => {
  it('should disable an enabled plugin', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/plugins',
      payload: validManifestBody(),
    });
    const pluginId = createResponse.json().id;

    const installResponse = await app.inject({
      method: 'POST',
      url: '/plugins/install',
      headers: { 'x-tenant-id': 'tenant-1' },
      payload: { pluginId, consentedPermissions: ['read:students'] },
    });
    const installId = installResponse.json().id;

    await app.inject({
      method: 'POST',
      url: `/plugins/installations/${installId}/enable`,
      headers: { 'x-tenant-id': 'tenant-1' },
    });

    const response = await app.inject({
      method: 'POST',
      url: `/plugins/installations/${installId}/disable`,
      headers: { 'x-tenant-id': 'tenant-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('disabled');
  });
});

describe('POST /plugins/installations/:installId/uninstall', () => {
  it('should uninstall a plugin', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/plugins',
      payload: validManifestBody(),
    });
    const pluginId = createResponse.json().id;

    const installResponse = await app.inject({
      method: 'POST',
      url: '/plugins/install',
      headers: { 'x-tenant-id': 'tenant-1' },
      payload: { pluginId, consentedPermissions: ['read:students'] },
    });
    const installId = installResponse.json().id;

    const response = await app.inject({
      method: 'POST',
      url: `/plugins/installations/${installId}/uninstall`,
      headers: { 'x-tenant-id': 'tenant-1' },
      payload: { reason: 'No longer needed' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('uninstalled');
  });
});

describe('GET /plugins/installations', () => {
  it('should list installations for a tenant', async () => {
    const createResponse = await app.inject({
      method: 'POST',
      url: '/plugins',
      payload: validManifestBody(),
    });
    const pluginId = createResponse.json().id;

    await app.inject({
      method: 'POST',
      url: '/plugins/install',
      headers: { 'x-tenant-id': 'tenant-1' },
      payload: { pluginId, consentedPermissions: ['read:students'] },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/plugins/installations',
      headers: { 'x-tenant-id': 'tenant-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(1);
  });
});
