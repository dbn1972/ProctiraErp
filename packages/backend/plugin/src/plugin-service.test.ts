/**
 * Plugin Service Unit Tests
 *
 * Tests the core business logic for plugin lifecycle management.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, BusinessRuleError } from '@proctira/common';

import { PluginService } from './plugin-service.js';
import { InMemoryPluginRepository } from './in-memory-repository.js';
import type { RegisterPluginInput, InstallPluginInput } from './schemas.js';

function createService(productVersion = '2.0.0') {
  const repository = new InMemoryPluginRepository();
  const service = new PluginService(repository, { productVersion });
  return { repository, service };
}

function validManifest(
  overrides: Partial<RegisterPluginInput['manifest']> = {},
): RegisterPluginInput['manifest'] {
  return {
    name: 'test-plugin',
    owner: 'proctira',
    version: '1.0.0',
    supportedProductVersions: '^2.0.0',
    requiredPermissions: ['read:students', 'write:attendance'],
    requiredExtensionPoints: ['after-create'],
    runtimeDependencies: [],
    tenantScopeBehavior: 'isolated',
    auditBehavior: 'Logs all data access operations',
    ...overrides,
  };
}

function validRegisterInput(overrides: Partial<RegisterPluginInput> = {}): RegisterPluginInput {
  return {
    manifest: validManifest(overrides.manifest as Partial<RegisterPluginInput['manifest']>),
    description: 'A test plugin',
    category: 'workflow',
    ...overrides,
  };
}

describe('PluginService', () => {
  describe('register', () => {
    it('should register a plugin with valid manifest', async () => {
      const { service } = createService();
      const input = validRegisterInput();

      const plugin = await service.register(input, 'admin-user');

      expect(plugin.id).toBeDefined();
      expect(plugin.name).toBe('test-plugin');
      expect(plugin.owner).toBe('proctira');
      expect(plugin.version).toBe('1.0.0');
      expect(plugin.status).toBe('active');
      expect(plugin.requiredPermissions).toEqual(['read:students', 'write:attendance']);
      expect(plugin.tenantScopeBehavior).toBe('isolated');
    });

    it('should reject duplicate plugin names', async () => {
      const { service } = createService();
      const input = validRegisterInput();

      await service.register(input, 'admin-user');

      await expect(service.register(input, 'admin-user')).rejects.toThrow(ConflictError);
    });

    it('should reject incompatible product versions', async () => {
      const { service } = createService('1.0.0');
      const input = validRegisterInput({
        manifest: validManifest({ supportedProductVersions: '^2.0.0' }),
      });

      await expect(service.register(input, 'admin-user')).rejects.toThrow(BusinessRuleError);
    });

    it('should accept wildcard version compatibility', async () => {
      const { service } = createService('1.0.0');
      const input = validRegisterInput({
        manifest: validManifest({ supportedProductVersions: '*' }),
      });

      const plugin = await service.register(input, 'admin-user');
      expect(plugin.name).toBe('test-plugin');
    });
  });

  describe('install', () => {
    it('should install a plugin for a tenant with consented permissions', async () => {
      const { service } = createService();
      const registerInput = validRegisterInput();
      const plugin = await service.register(registerInput, 'admin-user');

      const installInput: InstallPluginInput = {
        pluginId: plugin.id,
        consentedPermissions: ['read:students', 'write:attendance'],
      };

      const install = await service.install('tenant-1', installInput, 'tenant-admin');

      expect(install.id).toBeDefined();
      expect(install.pluginId).toBe(plugin.id);
      expect(install.tenantId).toBe('tenant-1');
      expect(install.status).toBe('installed');
      expect(install.consentedPermissions).toEqual(['read:students', 'write:attendance']);
    });

    it('should reject installation if plugin not found', async () => {
      const { service } = createService();
      const installInput: InstallPluginInput = {
        pluginId: 'a0000000-0000-4000-a000-000000000000',
        consentedPermissions: [],
      };

      await expect(service.install('tenant-1', installInput, 'admin')).rejects.toThrow(
        NotFoundError,
      );
    });

    it('should reject duplicate installation for same tenant', async () => {
      const { service } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');

      const installInput: InstallPluginInput = {
        pluginId: plugin.id,
        consentedPermissions: ['read:students', 'write:attendance'],
      };

      await service.install('tenant-1', installInput, 'admin');
      await expect(service.install('tenant-1', installInput, 'admin')).rejects.toThrow(
        ConflictError,
      );
    });

    it('should reject installation if required permissions not consented', async () => {
      const { service } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');

      const installInput: InstallPluginInput = {
        pluginId: plugin.id,
        consentedPermissions: ['read:students'], // missing 'write:attendance'
      };

      await expect(service.install('tenant-1', installInput, 'admin')).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it('should allow different tenants to install the same plugin', async () => {
      const { service } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');

      const installInput: InstallPluginInput = {
        pluginId: plugin.id,
        consentedPermissions: ['read:students', 'write:attendance'],
      };

      const install1 = await service.install('tenant-1', installInput, 'admin');
      const install2 = await service.install('tenant-2', installInput, 'admin');

      expect(install1.tenantId).toBe('tenant-1');
      expect(install2.tenantId).toBe('tenant-2');
    });
  });

  describe('enable', () => {
    it('should enable an installed plugin', async () => {
      const { service } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');
      const install = await service.install(
        'tenant-1',
        { pluginId: plugin.id, consentedPermissions: ['read:students', 'write:attendance'] },
        'admin',
      );

      const enabled = await service.enable('tenant-1', install.id, 'admin');

      expect(enabled.status).toBe('enabled');
      expect(enabled.enabledAt).toBeDefined();
    });

    it('should reject enabling an already enabled plugin', async () => {
      const { service } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');
      const install = await service.install(
        'tenant-1',
        { pluginId: plugin.id, consentedPermissions: ['read:students', 'write:attendance'] },
        'admin',
      );

      await service.enable('tenant-1', install.id, 'admin');
      await expect(service.enable('tenant-1', install.id, 'admin')).rejects.toThrow(
        BusinessRuleError,
      );
    });

    it('should reject enabling for wrong tenant', async () => {
      const { service } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');
      const install = await service.install(
        'tenant-1',
        { pluginId: plugin.id, consentedPermissions: ['read:students', 'write:attendance'] },
        'admin',
      );

      await expect(service.enable('tenant-2', install.id, 'admin')).rejects.toThrow(NotFoundError);
    });
  });

  describe('disable', () => {
    it('should disable an enabled plugin', async () => {
      const { service } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');
      const install = await service.install(
        'tenant-1',
        { pluginId: plugin.id, consentedPermissions: ['read:students', 'write:attendance'] },
        'admin',
      );
      await service.enable('tenant-1', install.id, 'admin');

      const disabled = await service.disable('tenant-1', install.id, 'admin');

      expect(disabled.status).toBe('disabled');
      expect(disabled.disabledAt).toBeDefined();
    });

    it('should reject disabling an already disabled plugin', async () => {
      const { service } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');
      const install = await service.install(
        'tenant-1',
        { pluginId: plugin.id, consentedPermissions: ['read:students', 'write:attendance'] },
        'admin',
      );
      await service.enable('tenant-1', install.id, 'admin');
      await service.disable('tenant-1', install.id, 'admin');

      await expect(service.disable('tenant-1', install.id, 'admin')).rejects.toThrow(
        BusinessRuleError,
      );
    });
  });

  describe('uninstall', () => {
    it('should uninstall a plugin and revoke all permissions', async () => {
      const { service, repository } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');
      const install = await service.install(
        'tenant-1',
        { pluginId: plugin.id, consentedPermissions: ['read:students', 'write:attendance'] },
        'admin',
      );

      const uninstalled = await service.uninstall(
        'tenant-1',
        install.id,
        'admin',
        'No longer needed',
      );

      expect(uninstalled.status).toBe('uninstalled');
      expect(uninstalled.uninstalledAt).toBeDefined();

      // Verify permissions are revoked
      const permissions = await repository.findPermissionsByInstall(install.id);
      expect(permissions.every((p) => p.status === 'revoked')).toBe(true);
    });

    it('should reject uninstalling an already uninstalled plugin', async () => {
      const { service } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');
      const install = await service.install(
        'tenant-1',
        { pluginId: plugin.id, consentedPermissions: ['read:students', 'write:attendance'] },
        'admin',
      );

      await service.uninstall('tenant-1', install.id, 'admin');
      await expect(service.uninstall('tenant-1', install.id, 'admin')).rejects.toThrow(
        BusinessRuleError,
      );
    });
  });

  describe('permissions', () => {
    it('should revoke a specific permission', async () => {
      const { service } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');
      const install = await service.install(
        'tenant-1',
        { pluginId: plugin.id, consentedPermissions: ['read:students', 'write:attendance'] },
        'admin',
      );

      const permissions = await service.getPermissions('tenant-1', install.id);
      expect(permissions).toHaveLength(2);

      await service.revokePermission('tenant-1', install.id, permissions[0]!.id, 'admin');

      const updatedPermissions = await service.getPermissions('tenant-1', install.id);
      const revoked = updatedPermissions.find((p) => p.id === permissions[0]!.id);
      expect(revoked?.status).toBe('revoked');
      expect(revoked?.revokedBy).toBe('admin');
    });
  });

  describe('listInstallations', () => {
    it('should list only installations for the specified tenant', async () => {
      const { service } = createService();
      const plugin = await service.register(validRegisterInput(), 'admin');

      await service.install(
        'tenant-1',
        { pluginId: plugin.id, consentedPermissions: ['read:students', 'write:attendance'] },
        'admin',
      );

      const tenant1Installs = await service.listInstallations('tenant-1');
      const tenant2Installs = await service.listInstallations('tenant-2');

      expect(tenant1Installs).toHaveLength(1);
      expect(tenant2Installs).toHaveLength(0);
    });
  });
});
