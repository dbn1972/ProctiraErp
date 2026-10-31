/**
 * PRC-L477 — plugin audit via an injected AuditPort with the real actor and tenant.
 *
 * Failing-first:
 *   - On the base source the route attributes a missing verified actor to the
 *     literal `'system'` (so a mutation with no `sub` still succeeds and records
 *     `'system'`); with the fix a mutation without a verified actor is 401 and
 *     no `'system'` audit row is written.
 *   - On the base source there is no injectable AuditPort: all audit rows go to
 *     the repository and never through a durable, tenant-aware sink. With the
 *     fix an injected port receives every lifecycle event carrying the REAL
 *     actor (`sub`) and tenant.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import type { PluginAuditEvent, PluginAuditPort } from './audit-port.js';
import { InMemoryPluginRepository } from './in-memory-repository.js';
import { PluginService } from './plugin-service.js';
import { registerPluginRoutes } from './routes.js';

function validManifestBody() {
  return {
    manifest: {
      name: 'audit-plugin',
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

class RecordingAuditPort implements PluginAuditPort {
  readonly events: PluginAuditEvent[] = [];
  async record(event: PluginAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

/**
 * Build an app whose principal is controlled per-request via headers:
 *   x-sub: the verified actor id (absent/blank = no verified actor)
 *   x-roles: comma-separated role ids
 */
function buildApp(service: PluginService): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    const r = request as unknown as FastifyRequest & {
      tenantId: string;
      user: { sub?: string; roles: { roleId: string }[] };
    };
    r.tenantId = (request.headers['x-tenant-id'] as string) || '';
    const sub = (request.headers['x-sub'] as string) || '';
    const roleHeader = (request.headers['x-roles'] as string) || '';
    r.user = {
      ...(sub ? { sub } : {}),
      roles: roleHeader
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((roleId) => ({ roleId })),
    };
  });
  return registerPluginRoutes(app, { pluginService: service }).then(() => app.ready());
}

let repository: InMemoryPluginRepository;
let port: RecordingAuditPort;
let service: PluginService;
let app: FastifyInstance;

beforeEach(async () => {
  repository = new InMemoryPluginRepository();
  port = new RecordingAuditPort();
  service = new PluginService(repository, { productVersion: '2.0.0' }, undefined, port);
  app = await buildApp(service);
});

describe('PRC-L477 injected AuditPort receives the real actor and tenant', () => {
  it('records register and install through the port with the real sub and tenant', async () => {
    const regRes = await app.inject({
      method: 'POST',
      url: '/plugins',
      headers: { 'x-sub': 'alice', 'x-roles': 'platform_admin' },
      payload: validManifestBody(),
    });
    expect(regRes.statusCode).toBe(201);
    const pluginId = regRes.json().id;

    const installRes = await app.inject({
      method: 'POST',
      url: '/plugins/install',
      headers: { 'x-tenant-id': 'tenant-xyz', 'x-sub': 'bob', 'x-roles': 'tenant_admin' },
      payload: { pluginId, consentedPermissions: ['read:students'] },
    });
    expect(installRes.statusCode).toBe(201);

    const register = port.events.find((e) => e.action === 'register');
    const install = port.events.find((e) => e.action === 'install');
    expect(register?.actor).toBe('alice');
    expect(install?.actor).toBe('bob');
    expect(install?.tenantId).toBe('tenant-xyz');
    // The literal 'system' actor must never be recorded for an authenticated mutation.
    expect(port.events.every((e) => e.actor !== 'system')).toBe(true);
  });
});

describe('PRC-L477 fail-closed when no verified actor is present', () => {
  it('returns 401 for a register with no verified sub and writes no audit row', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/plugins',
      headers: { 'x-roles': 'platform_admin' }, // no x-sub -> no verified actor
      payload: validManifestBody(),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('ACTOR_REQUIRED');
    expect(port.events).toHaveLength(0);
  });
});
