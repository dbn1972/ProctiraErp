/**
 * PRC-L479: cross-tenant isolation of the plugin install lifecycle and of hook
 * evaluation. A tenant must not read, change or revoke another tenant's
 * installation, and invoking an extension point for one tenant must never run
 * another tenant's hooks.
 *
 * The other L479 gaps have suites already: role guards (authz.test.ts),
 * sandbox escape (sandbox/plugin-sandbox.isolation.test.ts) and concurrency
 * (plugin-install-atomicity.test.ts).
 */
import { NotFoundError } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';
import { ExtensionPointRegistry } from './extension-points/extension-point-registry.js';
import { BUILT_IN_EXTENSION_POINTS } from './extension-points/index.js';
import type { HookResult } from './extension-points/types.js';
import { InMemoryPluginRepository } from './in-memory-repository.js';
import { PluginService } from './plugin-service.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const EP_ID = 'student.after-create';
const PERMISSIONS = ['student.read'];

async function setup() {
  const registry = new ExtensionPointRegistry();
  for (const ep of BUILT_IN_EXTENSION_POINTS) registry.registerExtensionPoint(ep);
  const service = new PluginService(
    new InMemoryPluginRepository(),
    { productVersion: '2.0.0' },
    registry,
  );
  const plugin = await service.register(
    {
      manifest: {
        name: 'isolated-plugin',
        owner: 'proctira',
        version: '1.0.0',
        supportedProductVersions: '^2.0.0',
        requiredPermissions: PERMISSIONS,
        requiredExtensionPoints: [EP_ID],
        runtimeDependencies: [],
        tenantScopeBehavior: 'isolated',
        auditBehavior: 'Logs all operations',
      },
    },
    'platform-admin',
    'platform-tenant',
  );
  const installA = await service.install(
    TENANT_A,
    { pluginId: plugin.id, consentedPermissions: PERMISSIONS },
    'admin-a',
  );
  return { registry, service, plugin, installA };
}

describe('PRC-L479 a tenant cannot reach another tenant installation', () => {
  it('hides tenant A installation from tenant B reads', async () => {
    const { service, installA } = await setup();
    await expect(service.getInstallation(TENANT_B, installA.id)).rejects.toThrow(NotFoundError);
    await expect(service.getPermissions(TENANT_B, installA.id)).rejects.toThrow(NotFoundError);
    expect(await service.listInstallations(TENANT_B)).toEqual([]);
  });

  it('rejects tenant B lifecycle changes to tenant A installation and leaves it unchanged', async () => {
    const { service, installA } = await setup();
    await expect(service.enable(TENANT_B, installA.id, 'admin-b')).rejects.toThrow(NotFoundError);
    await service.enable(TENANT_A, installA.id, 'admin-a');
    await expect(service.disable(TENANT_B, installA.id, 'admin-b')).rejects.toThrow(NotFoundError);
    await expect(service.uninstall(TENANT_B, installA.id, 'admin-b')).rejects.toThrow(
      NotFoundError,
    );
    const [permission] = await service.getPermissions(TENANT_A, installA.id);
    await expect(
      service.revokePermission(TENANT_B, installA.id, permission?.id ?? '', 'admin-b'),
    ).rejects.toThrow(NotFoundError);

    const after = await service.getInstallation(TENANT_A, installA.id);
    expect(after.status).toBe('enabled');
    const permissions = await service.getPermissions(TENANT_A, installA.id);
    expect(permissions.every((p) => p.status === 'consented')).toBe(true);
  });
});

describe('PRC-L479 hook evaluation is scoped to the invoking tenant', () => {
  it('never runs tenant A hooks when the extension point is invoked for tenant B', async () => {
    const { registry, plugin, installA } = await setup();
    const handler = vi.fn(async (): Promise<HookResult> => ({ success: true }));
    registry.registerHook({
      extensionPointId: EP_ID,
      pluginId: plugin.id,
      pluginInstallId: installA.id,
      tenantId: TENANT_A,
      handler: handler as unknown as Parameters<typeof registry.registerHook>[0]['handler'],
      pluginPermissions: PERMISSIONS,
    });

    expect(registry.getHookRegistrations(EP_ID, TENANT_B)).toHaveLength(0);
    const resultsB = await registry.invokeHooks(
      EP_ID,
      { id: 's-1' },
      { tenantId: TENANT_B, actorId: 'u-b' },
    );
    expect(resultsB).toEqual([]);
    expect(handler).not.toHaveBeenCalled();

    await registry.invokeHooks(EP_ID, { id: 's-1' }, { tenantId: TENANT_A, actorId: 'u-a' });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
