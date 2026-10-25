/**
 * PRC-L478: register / install / uninstall are check-then-act sequences. Concurrent
 * callers must not both pass the uniqueness or state check.
 */
import { BusinessRuleError, ConflictError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryPluginRepository } from './in-memory-repository.js';
import { PluginService } from './plugin-service.js';
import type { RegisterPluginInput } from './schemas.js';

const TENANT = 'tenant-l478';

function manifest(name = 'atomic-plugin'): RegisterPluginInput['manifest'] {
  return {
    name,
    owner: 'proctira',
    version: '1.0.0',
    supportedProductVersions: '^2.0.0',
    requiredPermissions: ['read:students'],
    requiredExtensionPoints: [],
    runtimeDependencies: [],
    tenantScopeBehavior: 'isolated',
    auditBehavior: 'Logs all data access operations',
  };
}

function setup() {
  const repository = new InMemoryPluginRepository();
  const service = new PluginService(repository, { productVersion: '2.0.0' });
  return { repository, service };
}

function outcome(results: PromiseSettledResult<unknown>[]) {
  return {
    fulfilled: results.filter((r) => r.status === 'fulfilled').length,
    rejected: results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason as unknown),
  };
}

describe('plugin lifecycle atomicity (PRC-L478)', () => {
  it('lets exactly one of two concurrent installs succeed', async () => {
    const { repository, service } = setup();
    const plugin = await service.register({ manifest: manifest() }, 'admin');
    const input = { pluginId: plugin.id, consentedPermissions: ['read:students'] };

    const results = await Promise.allSettled([
      service.install(TENANT, input, 'a'),
      service.install(TENANT, input, 'b'),
    ]);

    const { fulfilled, rejected } = outcome(results);
    expect(fulfilled).toBe(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toBeInstanceOf(ConflictError);
    expect(await repository.listInstallsByTenant(TENANT)).toHaveLength(1);
  });

  it('writes no permissions for the losing install', async () => {
    const { repository, service } = setup();
    const plugin = await service.register({ manifest: manifest() }, 'admin');
    const input = { pluginId: plugin.id, consentedPermissions: ['read:students'] };

    await Promise.allSettled([
      service.install(TENANT, input, 'a'),
      service.install(TENANT, input, 'b'),
    ]);

    const [install] = await repository.listInstallsByTenant(TENANT);
    const permissions = await repository.findPermissionsByInstall(install!.id);
    expect(permissions).toHaveLength(1);
    const installAudits = (await repository.listAuditEntries(plugin.id, TENANT)).filter(
      (e) => e.action === 'install',
    );
    expect(installAudits).toHaveLength(1);
  });

  it('lets exactly one of two concurrent registrations with the same name succeed', async () => {
    const { repository, service } = setup();

    const results = await Promise.allSettled([
      service.register({ manifest: manifest('dup-name') }, 'a'),
      service.register({ manifest: manifest('dup-name') }, 'b'),
    ]);

    const { fulfilled, rejected } = outcome(results);
    expect(fulfilled).toBe(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toBeInstanceOf(ConflictError);
    const listed = await repository.listPlugins({ search: 'dup-name' }, 1, 10);
    expect(listed.total).toBe(1);
  });

  it('lets exactly one of two concurrent uninstalls succeed', async () => {
    const { repository, service } = setup();
    const plugin = await service.register({ manifest: manifest() }, 'admin');
    const install = await service.install(
      TENANT,
      { pluginId: plugin.id, consentedPermissions: ['read:students'] },
      'admin',
    );

    const results = await Promise.allSettled([
      service.uninstall(TENANT, install.id, 'a'),
      service.uninstall(TENANT, install.id, 'b'),
    ]);

    const { fulfilled, rejected } = outcome(results);
    expect(fulfilled).toBe(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toBeInstanceOf(BusinessRuleError);
    const uninstallAudits = (await repository.listAuditEntries(plugin.id, TENANT)).filter(
      (e) => e.action === 'uninstall',
    );
    expect(uninstallAudits).toHaveLength(1);
    const permissions = await repository.findPermissionsByInstall(install.id);
    expect(permissions.every((p) => p.status === 'revoked')).toBe(true);
  });
});
