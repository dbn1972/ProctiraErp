/**
 * PRC-M604: disabling or uninstalling a plugin must remove its hooks, UI slot
 * components and event subscriptions from the extension-point registry, so a
 * disabled/uninstalled plugin stops receiving payloads.
 */
import { describe, expect, it, vi } from 'vitest';
import { BUILT_IN_EXTENSION_POINTS, BUILT_IN_EVENT_DEFINITIONS } from './extension-points/index.js';
import { ExtensionPointRegistry } from './extension-points/extension-point-registry.js';
import type { HookResult } from './extension-points/types.js';
import { InMemoryPluginRepository } from './in-memory-repository.js';
import { PluginService } from './plugin-service.js';

const TENANT = 'tenant-m604';
const EP_ID = 'student.after-create';
const PERMISSIONS = ['student.read', 'student.write'];

function setup() {
  const registry = new ExtensionPointRegistry();
  for (const ep of BUILT_IN_EXTENSION_POINTS) registry.registerExtensionPoint(ep);
  for (const ev of BUILT_IN_EVENT_DEFINITIONS) registry.registerEventDefinition(ev);
  const repository = new InMemoryPluginRepository();
  // Third constructor argument: the registry the service keeps in sync.
  const service = new PluginService(repository, { productVersion: '2.0.0' }, registry);
  return { registry, repository, service };
}

async function installAndHook(
  service: PluginService,
  registry: ExtensionPointRegistry,
  handler: ReturnType<typeof vi.fn>,
) {
  const plugin = await service.register(
    {
      manifest: {
        name: 'hooked-plugin',
        owner: 'proctira',
        version: '1.0.0',
        supportedProductVersions: '^2.0.0',
        requiredPermissions: PERMISSIONS,
        requiredExtensionPoints: [EP_ID],
        runtimeDependencies: [],
        tenantScopeBehavior: 'isolated',
        auditBehavior: 'Logs all data access operations',
      },
    },
    'admin',
  );
  const install = await service.install(
    TENANT,
    { pluginId: plugin.id, consentedPermissions: PERMISSIONS },
    'admin',
  );
  await service.enable(TENANT, install.id, 'admin');
  registry.registerHook({
    extensionPointId: EP_ID,
    pluginId: plugin.id,
    pluginInstallId: install.id,
    tenantId: TENANT,
    handler: handler as unknown as Parameters<typeof registry.registerHook>[0]['handler'],
    pluginPermissions: PERMISSIONS,
  });
  return { plugin, install };
}

describe('plugin lifecycle keeps the extension-point registry in sync (PRC-M604)', () => {
  it('disable removes the install hooks and stops invoking them', async () => {
    const { registry, repository, service } = setup();
    const handler = vi.fn(async (): Promise<HookResult> => ({ success: true }));
    const { plugin, install } = await installAndHook(service, registry, handler);
    expect(registry.getHookRegistrations(EP_ID, TENANT)).toHaveLength(1);

    await service.disable(TENANT, install.id, 'admin');

    expect(registry.getHookRegistrations(EP_ID, TENANT)).toHaveLength(0);
    await registry.invokeHooks(EP_ID, { id: 's-1' }, { tenantId: TENANT, actorId: 'u' });
    expect(handler).not.toHaveBeenCalled();
    const audit = (await repository.listAuditEntries(plugin.id, TENANT)).find(
      (e) => e.action === 'disable',
    );
    expect(audit?.details).toMatchObject({ hooksUnregistered: 1 });
  });

  it('uninstall removes the install hooks and stops invoking them', async () => {
    const { registry, repository, service } = setup();
    const handler = vi.fn(async (): Promise<HookResult> => ({ success: true }));
    const { plugin, install } = await installAndHook(service, registry, handler);

    await service.uninstall(TENANT, install.id, 'admin');

    expect(registry.getHookRegistrations(EP_ID, TENANT)).toHaveLength(0);
    await registry.invokeHooks(EP_ID, { id: 's-1' }, { tenantId: TENANT, actorId: 'u' });
    expect(handler).not.toHaveBeenCalled();
    const audit = (await repository.listAuditEntries(plugin.id, TENANT)).find(
      (e) => e.action === 'uninstall',
    );
    expect(audit?.details).toMatchObject({ hooksUnregistered: 1 });
  });

  it('leaves hooks of other installs untouched', async () => {
    const { registry, service } = setup();
    const handler = vi.fn(async (): Promise<HookResult> => ({ success: true }));
    const { plugin, install } = await installAndHook(service, registry, handler);
    const other = vi.fn(async (): Promise<HookResult> => ({ success: true }));
    registry.registerHook({
      extensionPointId: EP_ID,
      pluginId: plugin.id,
      pluginInstallId: 'another-install',
      tenantId: TENANT,
      handler: other as unknown as Parameters<typeof registry.registerHook>[0]['handler'],
      pluginPermissions: PERMISSIONS,
    });

    await service.disable(TENANT, install.id, 'admin');

    await registry.invokeHooks(EP_ID, { id: 's-1' }, { tenantId: TENANT, actorId: 'u' });
    expect(handler).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });
});
