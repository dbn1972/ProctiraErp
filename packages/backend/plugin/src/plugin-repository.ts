/**
 * Plugin Repository Interface
 *
 * Defines the data access contract for plugin entities.
 * Implementations can target PostgreSQL (production) or in-memory (testing).
 */

/**
 * Represents a registered plugin in the plugin_plugins table.
 */
export interface PluginEntity {
  id: string;
  name: string;
  owner: string;
  version: string;
  description: string | null;
  category: string | null;
  status: 'active' | 'deprecated' | 'removed';
  supportedProductVersions: string;
  requiredPermissions: string[];
  requiredExtensionPoints: string[];
  tenantScopeBehavior: 'isolated' | 'shared';
  auditBehavior: string;
  configSchema: Record<string, unknown> | null;
  runtimeDependencies: string[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Represents a plugin manifest stored in plugin_manifests table.
 */
export interface PluginManifestEntity {
  id: string;
  pluginId: string;
  version: string;
  manifestData: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Represents a plugin installation for a tenant in plugin_installs table.
 */
export interface PluginInstallEntity {
  id: string;
  pluginId: string;
  tenantId: string;
  status: 'installed' | 'enabled' | 'disabled' | 'uninstalled';
  consentedPermissions: string[];
  configuration: Record<string, unknown> | null;
  installedAt: Date;
  enabledAt: Date | null;
  disabledAt: Date | null;
  uninstalledAt: Date | null;
  updatedAt: Date;
}

/**
 * Represents a permission record in plugin_permissions table.
 */
export interface PluginPermissionEntity {
  id: string;
  installId: string;
  pluginId: string;
  tenantId: string;
  permission: string;
  status: 'consented' | 'revoked';
  consentedAt: Date;
  revokedAt: Date | null;
  consentedBy: string;
  revokedBy: string | null;
}

/**
 * Audit log entry for plugin operations.
 */
export interface PluginAuditEntry {
  id: string;
  pluginId: string;
  tenantId: string;
  installId: string | null;
  action: 'register' | 'install' | 'enable' | 'disable' | 'uninstall' | 'permission_consent' | 'permission_revoke';
  actor: string;
  details: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Filter options for listing plugins.
 */
export interface PluginFilter {
  category?: string;
  search?: string;
  status?: string;
}

/**
 * Repository interface for plugin data access.
 */
export interface PluginRepository {
  // Plugin registry operations
  createPlugin(entity: Omit<PluginEntity, 'createdAt' | 'updatedAt'>): Promise<PluginEntity>;
  findPluginById(id: string): Promise<PluginEntity | null>;
  findPluginByName(name: string): Promise<PluginEntity | null>;
  listPlugins(filter: PluginFilter, page: number, pageSize: number): Promise<{ data: PluginEntity[]; total: number }>;
  updatePlugin(id: string, updates: Partial<Pick<PluginEntity, 'status' | 'version' | 'description' | 'category'>>): Promise<PluginEntity>;

  // Manifest operations
  createManifest(entity: Omit<PluginManifestEntity, 'createdAt'>): Promise<PluginManifestEntity>;
  findManifestByPluginAndVersion(pluginId: string, version: string): Promise<PluginManifestEntity | null>;

  // Install operations
  createInstall(entity: Omit<PluginInstallEntity, 'installedAt' | 'enabledAt' | 'disabledAt' | 'uninstalledAt' | 'updatedAt'>): Promise<PluginInstallEntity>;
  findInstallById(id: string): Promise<PluginInstallEntity | null>;
  findInstallByPluginAndTenant(pluginId: string, tenantId: string): Promise<PluginInstallEntity | null>;
  listInstallsByTenant(tenantId: string): Promise<PluginInstallEntity[]>;
  updateInstall(id: string, updates: Partial<Pick<PluginInstallEntity, 'status' | 'configuration' | 'enabledAt' | 'disabledAt' | 'uninstalledAt'>>): Promise<PluginInstallEntity>;

  // Permission operations
  createPermissions(entities: Omit<PluginPermissionEntity, 'revokedAt' | 'revokedBy'>[]): Promise<PluginPermissionEntity[]>;
  findPermissionsByInstall(installId: string): Promise<PluginPermissionEntity[]>;
  revokePermission(id: string, revokedBy: string): Promise<PluginPermissionEntity>;
  revokeAllPermissionsByInstall(installId: string, revokedBy: string): Promise<void>;

  // Audit operations
  createAuditEntry(entry: Omit<PluginAuditEntry, 'timestamp'>): Promise<PluginAuditEntry>;
  listAuditEntries(pluginId: string, tenantId: string): Promise<PluginAuditEntry[]>;
}
