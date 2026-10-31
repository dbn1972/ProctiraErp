/**
 * Plugin in-package authorization + consent-ceiling tests.
 *
 * PRC-M603 / PRC-M627 — the parked plugin package must still enforce, in-package:
 *   - only a platform admin may register a plugin into the shared registry;
 *   - only a tenant admin (or platform admin) may install/enable/disable/uninstall
 *     a plugin for the current tenant.
 * PRC-L479 — consent may not exceed the plugin's declared requiredPermissions
 *   (a consent ceiling), so an install cannot silently grant more than the
 *   manifest asks for.
 *
 * Failing-first: on the base source (no guard, no ceiling) a non-admin caller
 * succeeds (201/200) and an over-broad consent is accepted; with the fix each
 * unauthorised mutation is 403 and the over-broad consent is rejected.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

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

/** Role headers: x-roles is a comma-separated list of role ids. */
function headers(tenantId: string, roles: string): Record<string, string> {
  return { 'x-tenant-id': tenantId, 'x-roles': roles };
}

const PLATFORM = 'platform_admin';
const TENANT = 'tenant_admin';
const TEACHER = 'teacher';

beforeEach(async () => {
  app = Fastify();
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const r = request as unknown as FastifyRequest & {
      tenantId: string;
      user: { sub: string; roles: { roleId: string }[] };
    };
    r.tenantId = (request.headers['x-tenant-id'] as string) || '';
    const roleHeader = (request.headers['x-roles'] as string) || '';
    r.user = {
      sub: (request.headers['x-sub'] as string) || 'user-1',
      roles: roleHeader
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((roleId) => ({ roleId })),
    };
  });

  const repository = new InMemoryPluginRepository();
  service = new PluginService(repository, { productVersion: '2.0.0' });
  await registerPluginRoutes(app, { pluginService: service });
  await app.ready();
});

async function registerAsPlatform() {
  return app.inject({
    method: 'POST',
    url: '/plugins',
    headers: headers('', PLATFORM),
    payload: validManifestBody(),
  });
}

describe('PRC-M603 register requires platform admin', () => {
  it('rejects a non-platform-admin (tenant admin) with 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/plugins',
      headers: headers('', TENANT),
      payload: validManifestBody(),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('allows a platform admin (201)', async () => {
    const res = await registerAsPlatform();
    expect(res.statusCode).toBe(201);
  });
});

describe('PRC-M627 install/enable/disable/uninstall require tenant admin', () => {
  it('rejects a non-admin (teacher) install with 403', async () => {
    const pluginId = (await registerAsPlatform()).json().id;
    const res = await app.inject({
      method: 'POST',
      url: '/plugins/install',
      headers: headers('tenant-1', TEACHER),
      payload: { pluginId, consentedPermissions: ['read:students'] },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('rejects a non-admin enable/disable/uninstall with 403', async () => {
    const pluginId = (await registerAsPlatform()).json().id;
    const installId = (
      await app.inject({
        method: 'POST',
        url: '/plugins/install',
        headers: headers('tenant-1', TENANT),
        payload: { pluginId, consentedPermissions: ['read:students'] },
      })
    ).json().id;

    for (const action of ['enable', 'disable', 'uninstall']) {
      const res = await app.inject({
        method: 'POST',
        url: `/plugins/installations/${installId}/${action}`,
        headers: headers('tenant-1', TEACHER),
        payload: {},
      });
      expect(res.statusCode).toBe(403);
    }
  });

  it('allows a tenant admin to install and enable', async () => {
    const pluginId = (await registerAsPlatform()).json().id;
    const installRes = await app.inject({
      method: 'POST',
      url: '/plugins/install',
      headers: headers('tenant-1', TENANT),
      payload: { pluginId, consentedPermissions: ['read:students'] },
    });
    expect(installRes.statusCode).toBe(201);
    const installId = installRes.json().id;
    const enableRes = await app.inject({
      method: 'POST',
      url: `/plugins/installations/${installId}/enable`,
      headers: headers('tenant-1', TENANT),
    });
    expect(enableRes.statusCode).toBe(200);
  });
});

describe('PRC-L479 consent ceiling: consent may not exceed requiredPermissions', () => {
  it('rejects an install whose consent includes a permission the manifest does not require', async () => {
    const pluginId = (await registerAsPlatform()).json().id;
    const res = await app.inject({
      method: 'POST',
      url: '/plugins/install',
      headers: headers('tenant-1', TENANT),
      payload: {
        pluginId,
        // read:students is required; write:grades is NOT in the manifest -> over-broad.
        consentedPermissions: ['read:students', 'write:grades'],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('BUSINESS_RULE_ERROR');
  });

  it('allows an install whose consent exactly matches requiredPermissions', async () => {
    const pluginId = (await registerAsPlatform()).json().id;
    const res = await app.inject({
      method: 'POST',
      url: '/plugins/install',
      headers: headers('tenant-1', TENANT),
      payload: { pluginId, consentedPermissions: ['read:students'] },
    });
    expect(res.statusCode).toBe(201);
  });
});
