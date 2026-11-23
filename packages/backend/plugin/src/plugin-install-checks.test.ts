/**
 * PRC-M627: install validates configuration against the manifest configSchema
 * and checks that the required extension points exist; enable re-checks the
 * plugin status and product compatibility. (Consent above requiredPermissions
 * is rejected by the consent ceiling, tested in authz.test.ts.)
 *
 * Failing-first: on the base source install stores any configuration and
 * ignores missing extension points, and enable succeeds for a deprecated plugin.
 */
import { BusinessRuleError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { ExtensionPointRegistry } from './extension-points/extension-point-registry.js';
import { BUILT_IN_EXTENSION_POINTS } from './extension-points/index.js';
import { InMemoryPluginRepository } from './in-memory-repository.js';
import { PluginService } from './plugin-service.js';

const TENANT = 'tenant-m627';
const PERMISSIONS = ['student.read'];

function manifest(requiredExtensionPoints: string[] = ['student.after-create']) {
  return {
    name: 'configured-plugin',
    owner: 'proctira',
    version: '1.0.0',
    supportedProductVersions: '^2.0.0',
    requiredPermissions: PERMISSIONS,
    requiredExtensionPoints,
    runtimeDependencies: [],
    tenantScopeBehavior: 'isolated' as const,
    auditBehavior: 'Logs all operations',
    configSchema: {
      type: 'object',
      properties: {
        webhookUrl: { type: 'string' },
        threshold: { type: 'number' },
        delimiter: { type: 'string', enum: [',', ';'] },
      },
      required: ['webhookUrl'],
      additionalProperties: false,
    },
  };
}

function setup() {
  const registry = new ExtensionPointRegistry();
  for (const ep of BUILT_IN_EXTENSION_POINTS) registry.registerExtensionPoint(ep);
  const repository = new InMemoryPluginRepository();
  const service = new PluginService(repository, { productVersion: '2.0.0' }, registry);
  return { repository, service };
}

async function registered(service: PluginService, eps?: string[]) {
  return service.register({ manifest: manifest(eps) }, 'admin', 'platform-tenant');
}

describe('PRC-M627 install validates configuration against configSchema', () => {
  it.each([
    ['a missing required key', { threshold: 5 }],
    ['a wrong type', { webhookUrl: 42 }],
    ['a value outside enum', { webhookUrl: 'https://hooks.example.com', delimiter: '|' }],
    ['an undeclared key', { webhookUrl: 'https://hooks.example.com', extra: true }],
  ])('rejects %s', async (_label, configuration) => {
    const { service } = setup();
    const plugin = await registered(service);
    await expect(
      service.install(
        TENANT,
        { pluginId: plugin.id, consentedPermissions: PERMISSIONS, configuration },
        'admin',
      ),
    ).rejects.toThrow(BusinessRuleError);
  });

  it('accepts a configuration that satisfies the schema', async () => {
    const { service } = setup();
    const plugin = await registered(service);
    const install = await service.install(
      TENANT,
      {
        pluginId: plugin.id,
        consentedPermissions: PERMISSIONS,
        configuration: { webhookUrl: 'https://hooks.example.com', threshold: 5, delimiter: ';' },
      },
      'admin',
    );
    expect(install.configuration).toEqual({
      webhookUrl: 'https://hooks.example.com',
      threshold: 5,
      delimiter: ';',
    });
  });
});

describe('PRC-M627 install checks the required extension points exist', () => {
  it('rejects a plugin whose required extension point is not registered', async () => {
    const { service } = setup();
    const plugin = await registered(service, ['no-such.extension-point']);
    await expect(
      service.install(
        TENANT,
        {
          pluginId: plugin.id,
          consentedPermissions: PERMISSIONS,
          configuration: { webhookUrl: 'https://hooks.example.com' },
        },
        'admin',
      ),
    ).rejects.toThrow(/extension points are not available/);
  });
});

describe('PRC-M627 enable re-checks plugin status', () => {
  it('rejects enabling an install of a plugin that is no longer active', async () => {
    const { repository, service } = setup();
    const plugin = await registered(service);
    const install = await service.install(
      TENANT,
      {
        pluginId: plugin.id,
        consentedPermissions: PERMISSIONS,
        configuration: { webhookUrl: 'https://hooks.example.com' },
      },
      'admin',
    );
    await repository.updatePlugin(plugin.id, { status: 'deprecated' });
    await expect(service.enable(TENANT, install.id, 'admin')).rejects.toThrow(
      /cannot be enabled \(status: deprecated\)/,
    );
  });
});
