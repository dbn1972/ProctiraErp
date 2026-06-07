/**
 * Plugin Service
 *
 * Core business logic for plugin lifecycle management:
 * - Register: Add a plugin to the registry with manifest validation
 * - Install: Install a plugin for a tenant with permission consent
 * - Enable: Activate an installed plugin
 * - Disable: Deactivate an installed plugin
 * - Uninstall: Remove a plugin installation and revoke permissions
 *
 * All operations are tenant-scoped and produce audit log entries.
 */
import { v4 as uuidv4 } from 'uuid';
import { AppError, NotFoundError, ConflictError, BusinessRuleError } from '@proctira/common';

import type { PluginRepository, PluginEntity, PluginInstallEntity } from './plugin-repository.js';
import type { PluginManifest, RegisterPluginInput, InstallPluginInput } from './schemas.js';
import { validateCompatibility } from './compatibility.js';

/**
 * Configuration for the plugin service.
 */
export interface PluginServiceConfig {
  /** Current product version for compatibility checks */
  productVersion: string;
}

/**
 * Plugin Service - manages the full plugin lifecycle.
 */
export class PluginService {
  constructor(
    private readonly repository: PluginRepository,
    private readonly config: PluginServiceConfig,
  ) {}

  /**
   * Register a new plugin in the registry.
   * Validates the manifest and checks for name uniqueness.
   */
  async register(input: RegisterPluginInput, actor: string): Promise<PluginEntity> {
    const { manifest, description, category } = input;

    // Check for duplicate plugin name
    const existing = await this.repository.findPluginByName(manifest.name);
    if (existing) {
      throw new ConflictError(`Plugin with name '${manifest.name}' already exists`);
    }

    // Validate compatibility with current product version
    const compatibility = validateCompatibility(this.config.productVersion, manifest.supportedProductVersions);
    if (!compatibility.compatible) {
      throw new BusinessRuleError(compatibility.message);
    }

    const pluginId = uuidv4();

    // Create the plugin entity
    const plugin = await this.repository.createPlugin({
      id: pluginId,
      name: manifest.name,
      owner: manifest.owner,
      version: manifest.version,
      description: description ?? null,
      category: category ?? null,
      status: 'active',
      supportedProductVersions: manifest.supportedProductVersions,
      requiredPermissions: manifest.requiredPermissions,
      requiredExtensionPoints: manifest.requiredExtensionPoints,
      tenantScopeBehavior: manifest.tenantScopeBehavior,
      auditBehavior: manifest.auditBehavior,
      configSchema: manifest.configSchema ?? null,
      runtimeDependencies: manifest.runtimeDependencies,
    });

    // Store the manifest
    await this.repository.createManifest({
      id: uuidv4(),
      pluginId,
      version: manifest.version,
      manifestData: manifest as unknown as Record<string, unknown>,
    });

    // Audit log (use a system tenant for registry-level operations)
    await this.repository.createAuditEntry({
      id: uuidv4(),
      pluginId,
      tenantId: 'system',
      installId: null,
      action: 'register',
      actor,
      details: { name: manifest.name, version: manifest.version },
    });

    return plugin;
  }

  /**
   * Get a plugin by ID.
   */
  async getById(pluginId: string): Promise<PluginEntity> {
    const plugin = await this.repository.findPluginById(pluginId);
    if (!plugin) {
      throw new NotFoundError(`Plugin not found: ${pluginId}`);
    }
    return plugin;
  }

  /**
   * List plugins with filtering and pagination.
   */
  async list(filter: { category?: string; search?: string }, page: number, pageSize: number) {
    return this.repository.listPlugins(filter, page, pageSize);
  }

  /**
   * Install a plugin for a specific tenant.
   * Validates compatibility, checks for existing installation,
   * and records consented permissions.
   */
  async install(tenantId: string, input: InstallPluginInput, actor: string): Promise<PluginInstallEntity> {
    const { pluginId, consentedPermissions, configuration } = input;

    // Verify plugin exists and is active
    const plugin = await this.repository.findPluginById(pluginId);
    if (!plugin) {
      throw new NotFoundError(`Plugin not found: ${pluginId}`);
    }
    if (plugin.status !== 'active') {
      throw new BusinessRuleError(`Plugin '${plugin.name}' is not available for installation (status: ${plugin.status})`);
    }

    // Check compatibility with current product version
    const compatibility = validateCompatibility(this.config.productVersion, plugin.supportedProductVersions);
    if (!compatibility.compatible) {
      throw new BusinessRuleError(compatibility.message);
    }

    // Check for existing active installation
    const existingInstall = await this.repository.findInstallByPluginAndTenant(pluginId, tenantId);
    if (existingInstall) {
      throw new ConflictError(`Plugin '${plugin.name}' is already installed for this tenant`);
    }

    // Validate that consented permissions cover all required permissions
    const missingPermissions = plugin.requiredPermissions.filter(
      (p) => !consentedPermissions.includes(p),
    );
    if (missingPermissions.length > 0) {
      throw new BusinessRuleError(
        `Missing required permission consent: ${missingPermissions.join(', ')}`,
      );
    }

    const installId = uuidv4();

    // Create the installation record
    const install = await this.repository.createInstall({
      id: installId,
      pluginId,
      tenantId,
      status: 'installed',
      consentedPermissions,
      configuration: configuration ?? null,
    });

    // Record permissions
    const permissionEntities = consentedPermissions.map((permission) => ({
      id: uuidv4(),
      installId,
      pluginId,
      tenantId,
      permission,
      status: 'consented' as const,
      consentedAt: new Date(),
      consentedBy: actor,
    }));

    if (permissionEntities.length > 0) {
      await this.repository.createPermissions(permissionEntities);
    }

    // Audit log
    await this.repository.createAuditEntry({
      id: uuidv4(),
      pluginId,
      tenantId,
      installId,
      action: 'install',
      actor,
      details: {
        pluginName: plugin.name,
        version: plugin.version,
        consentedPermissions,
      },
    });

    return install;
  }

  /**
   * Enable an installed plugin.
   */
  async enable(tenantId: string, installId: string, actor: string): Promise<PluginInstallEntity> {
    const install = await this.repository.findInstallById(installId);
    if (!install) {
      throw new NotFoundError(`Plugin installation not found: ${installId}`);
    }
    if (install.tenantId !== tenantId) {
      throw new NotFoundError(`Plugin installation not found: ${installId}`);
    }
    if (install.status === 'uninstalled') {
      throw new BusinessRuleError('Cannot enable an uninstalled plugin');
    }
    if (install.status === 'enabled') {
      throw new BusinessRuleError('Plugin is already enabled');
    }

    const updated = await this.repository.updateInstall(installId, {
      status: 'enabled',
      enabledAt: new Date(),
    });

    // Audit log
    await this.repository.createAuditEntry({
      id: uuidv4(),
      pluginId: install.pluginId,
      tenantId,
      installId,
      action: 'enable',
      actor,
      details: { previousStatus: install.status },
    });

    return updated;
  }

  /**
   * Disable an installed plugin.
   */
  async disable(tenantId: string, installId: string, actor: string): Promise<PluginInstallEntity> {
    const install = await this.repository.findInstallById(installId);
    if (!install) {
      throw new NotFoundError(`Plugin installation not found: ${installId}`);
    }
    if (install.tenantId !== tenantId) {
      throw new NotFoundError(`Plugin installation not found: ${installId}`);
    }
    if (install.status === 'uninstalled') {
      throw new BusinessRuleError('Cannot disable an uninstalled plugin');
    }
    if (install.status === 'disabled') {
      throw new BusinessRuleError('Plugin is already disabled');
    }

    const updated = await this.repository.updateInstall(installId, {
      status: 'disabled',
      disabledAt: new Date(),
    });

    // Audit log
    await this.repository.createAuditEntry({
      id: uuidv4(),
      pluginId: install.pluginId,
      tenantId,
      installId,
      action: 'disable',
      actor,
      details: { previousStatus: install.status },
    });

    return updated;
  }

  /**
   * Uninstall a plugin for a tenant.
   * Revokes all permissions and marks the installation as uninstalled.
   */
  async uninstall(tenantId: string, installId: string, actor: string, reason?: string): Promise<PluginInstallEntity> {
    const install = await this.repository.findInstallById(installId);
    if (!install) {
      throw new NotFoundError(`Plugin installation not found: ${installId}`);
    }
    if (install.tenantId !== tenantId) {
      throw new NotFoundError(`Plugin installation not found: ${installId}`);
    }
    if (install.status === 'uninstalled') {
      throw new BusinessRuleError('Plugin is already uninstalled');
    }

    // Revoke all permissions
    await this.repository.revokeAllPermissionsByInstall(installId, actor);

    const updated = await this.repository.updateInstall(installId, {
      status: 'uninstalled',
      uninstalledAt: new Date(),
    });

    // Audit log
    await this.repository.createAuditEntry({
      id: uuidv4(),
      pluginId: install.pluginId,
      tenantId,
      installId,
      action: 'uninstall',
      actor,
      details: { reason: reason ?? 'No reason provided' },
    });

    return updated;
  }

  /**
   * List all plugin installations for a tenant.
   */
  async listInstallations(tenantId: string): Promise<PluginInstallEntity[]> {
    return this.repository.listInstallsByTenant(tenantId);
  }

  /**
   * Get a specific installation by ID.
   */
  async getInstallation(tenantId: string, installId: string): Promise<PluginInstallEntity> {
    const install = await this.repository.findInstallById(installId);
    if (!install || install.tenantId !== tenantId) {
      throw new NotFoundError(`Plugin installation not found: ${installId}`);
    }
    return install;
  }

  /**
   * Revoke a specific permission for a plugin installation.
   */
  async revokePermission(tenantId: string, installId: string, permissionId: string, actor: string): Promise<void> {
    const install = await this.repository.findInstallById(installId);
    if (!install || install.tenantId !== tenantId) {
      throw new NotFoundError(`Plugin installation not found: ${installId}`);
    }

    const permissions = await this.repository.findPermissionsByInstall(installId);
    const permission = permissions.find((p) => p.id === permissionId);
    if (!permission) {
      throw new NotFoundError(`Permission not found: ${permissionId}`);
    }
    if (permission.status === 'revoked') {
      throw new BusinessRuleError('Permission is already revoked');
    }

    await this.repository.revokePermission(permissionId, actor);

    // Audit log
    await this.repository.createAuditEntry({
      id: uuidv4(),
      pluginId: install.pluginId,
      tenantId,
      installId,
      action: 'permission_revoke',
      actor,
      details: { permission: permission.permission },
    });
  }

  /**
   * Get permissions for a plugin installation.
   */
  async getPermissions(tenantId: string, installId: string) {
    const install = await this.repository.findInstallById(installId);
    if (!install || install.tenantId !== tenantId) {
      throw new NotFoundError(`Plugin installation not found: ${installId}`);
    }
    return this.repository.findPermissionsByInstall(installId);
  }
}
