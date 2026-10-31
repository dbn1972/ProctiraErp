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
import { NotFoundError, ConflictError, BusinessRuleError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type { PluginAuditPort, PluginAuditEvent } from './audit-port.js';
import { validateCompatibility } from './compatibility.js';
import type { ExtensionPointRegistry } from './extension-points/extension-point-registry.js';
import type { PluginRepository, PluginEntity, PluginInstallEntity } from './plugin-repository.js';
import type { RegisterPluginInput, InstallPluginInput } from './schemas.js';

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
    /**
     * PRC-M604: runtime registry of hooks, UI slot components and event
     * subscriptions. When provided, disable/uninstall remove the install's
     * registrations so the plugin stops receiving payloads.
     */
    private readonly registry?: Pick<ExtensionPointRegistry, 'unregisterAllForInstall'>,
    /**
     * PRC-L477: injected audit sink carrying the real actor and tenant. When
     * provided, all lifecycle audit events are recorded through it (durable,
     * tenant-aware). When omitted, the service falls back to the repository's
     * audit log so existing callers and tests are unchanged.
     */
    private readonly auditPort?: PluginAuditPort,
  ) {}

  /**
   * PRC-L477: record a plugin audit event through the injected port when one is
   * configured, otherwise through the repository. The caller always supplies the
   * real `actor` and `tenantId`; this method never substitutes a `'system'` actor.
   */
  private async audit(entry: PluginAuditEvent) {
    if (this.auditPort) {
      await this.auditPort.record(entry);
      return;
    }
    await this.repository.createAuditEntry(entry);
  }

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
    const compatibility = validateCompatibility(
      this.config.productVersion,
      manifest.supportedProductVersions,
    );
    if (!compatibility.compatible) {
      throw new BusinessRuleError(compatibility.message);
    }

    const pluginId = uuidv4();

    // PRC-L478: create the plugin and its manifest atomically; the repository
    // re-checks name uniqueness so concurrent registrations cannot both succeed.
    const plugin = await this.repository.registerAtomically(
      {
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
      },
      {
        id: uuidv4(),
        pluginId,
        version: manifest.version,
        manifestData: manifest as unknown as Record<string, unknown>,
      },
    );
    if (!plugin) {
      throw new ConflictError(`Plugin with name '${manifest.name}' already exists`);
    }

    // Audit log (use a system tenant for registry-level operations)
    await this.audit({
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
  async install(
    tenantId: string,
    input: InstallPluginInput,
    actor: string,
  ): Promise<PluginInstallEntity> {
    const { pluginId, consentedPermissions, configuration } = input;

    // Verify plugin exists and is active
    const plugin = await this.repository.findPluginById(pluginId);
    if (!plugin) {
      throw new NotFoundError(`Plugin not found: ${pluginId}`);
    }
    if (plugin.status !== 'active') {
      throw new BusinessRuleError(
        `Plugin '${plugin.name}' is not available for installation (status: ${plugin.status})`,
      );
    }

    // Check compatibility with current product version
    const compatibility = validateCompatibility(
      this.config.productVersion,
      plugin.supportedProductVersions,
    );
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

    // PRC-L479: consent ceiling — consent may not exceed the plugin's declared
    // requiredPermissions, so an install cannot silently grant a permission the
    // manifest never asked for. Anything consented beyond requiredPermissions is
    // rejected (fail-closed), not clamped.
    const excessPermissions = consentedPermissions.filter(
      (p) => !plugin.requiredPermissions.includes(p),
    );
    if (excessPermissions.length > 0) {
      throw new BusinessRuleError(
        `Consented permissions exceed the plugin's required permissions: ${excessPermissions.join(', ')}`,
      );
    }

    const installId = uuidv4();

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

    // PRC-L478: create the install and its permissions atomically; the repository
    // re-checks for an active install so concurrent installs cannot both succeed.
    const install = await this.repository.installAtomically(
      {
        id: installId,
        pluginId,
        tenantId,
        status: 'installed',
        consentedPermissions,
        configuration: configuration ?? null,
      },
      permissionEntities,
    );
    if (!install) {
      throw new ConflictError(`Plugin '${plugin.name}' is already installed for this tenant`);
    }

    // Audit log
    await this.audit({
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
    await this.audit({
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

    // PRC-M604: a disabled plugin must stop receiving hook/event payloads.
    const hooksUnregistered = this.registry?.unregisterAllForInstall(installId) ?? 0;

    // Audit log
    await this.audit({
      id: uuidv4(),
      pluginId: install.pluginId,
      tenantId,
      installId,
      action: 'disable',
      actor,
      details: { previousStatus: install.status, hooksUnregistered },
    });

    return updated;
  }

  /**
   * Uninstall a plugin for a tenant.
   * Revokes all permissions and marks the installation as uninstalled.
   */
  async uninstall(
    tenantId: string,
    installId: string,
    actor: string,
    reason?: string,
  ): Promise<PluginInstallEntity> {
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

    // PRC-L478: revoke all permissions and mark uninstalled atomically; the
    // repository re-checks the state so concurrent uninstalls cannot both succeed.
    const updated = await this.repository.uninstallAtomically(installId, actor, {
      uninstalledAt: new Date(),
    });
    if (!updated) {
      throw new BusinessRuleError('Plugin is already uninstalled');
    }

    // PRC-M604: an uninstalled plugin must stop receiving hook/event payloads.
    const hooksUnregistered = this.registry?.unregisterAllForInstall(installId) ?? 0;

    // Audit log
    await this.audit({
      id: uuidv4(),
      pluginId: install.pluginId,
      tenantId,
      installId,
      action: 'uninstall',
      actor,
      details: { reason: reason ?? 'No reason provided', hooksUnregistered },
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
  async revokePermission(
    tenantId: string,
    installId: string,
    permissionId: string,
    actor: string,
  ): Promise<void> {
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
    await this.audit({
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
