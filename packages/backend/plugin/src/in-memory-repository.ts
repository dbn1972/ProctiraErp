/**
 * In-Memory Plugin Repository
 *
 * Used for testing and local development without a database.
 */
import type {
  PluginRepository,
  PluginEntity,
  PluginManifestEntity,
  PluginInstallEntity,
  PluginPermissionEntity,
  PluginAuditEntry,
  PluginFilter,
} from './plugin-repository.js';

export class InMemoryPluginRepository implements PluginRepository {
  private plugins: Map<string, PluginEntity> = new Map();
  private manifests: Map<string, PluginManifestEntity> = new Map();
  private installs: Map<string, PluginInstallEntity> = new Map();
  private permissions: Map<string, PluginPermissionEntity> = new Map();
  private auditEntries: PluginAuditEntry[] = [];

  // ─── Plugin Registry ──────────────────────────────────────────────────────

  async createPlugin(entity: Omit<PluginEntity, 'createdAt' | 'updatedAt'>): Promise<PluginEntity> {
    const now = new Date();
    const plugin: PluginEntity = { ...entity, createdAt: now, updatedAt: now };
    this.plugins.set(plugin.id, plugin);
    return plugin;
  }

  async findPluginById(id: string): Promise<PluginEntity | null> {
    return this.plugins.get(id) ?? null;
  }

  async findPluginByName(name: string): Promise<PluginEntity | null> {
    for (const plugin of this.plugins.values()) {
      if (plugin.name === name) return plugin;
    }
    return null;
  }

  async listPlugins(filter: PluginFilter, page: number, pageSize: number): Promise<{ data: PluginEntity[]; total: number }> {
    let results = Array.from(this.plugins.values());

    if (filter.category) {
      results = results.filter((p) => p.category === filter.category);
    }
    if (filter.status) {
      results = results.filter((p) => p.status === filter.status);
    }
    if (filter.search) {
      const search = filter.search.toLowerCase();
      results = results.filter(
        (p) => p.name.toLowerCase().includes(search) || (p.description?.toLowerCase().includes(search) ?? false),
      );
    }

    const total = results.length;
    const offset = (page - 1) * pageSize;
    const data = results.slice(offset, offset + pageSize);

    return { data, total };
  }

  async updatePlugin(id: string, updates: Partial<Pick<PluginEntity, 'status' | 'version' | 'description' | 'category'>>): Promise<PluginEntity> {
    const plugin = this.plugins.get(id);
    if (!plugin) throw new Error(`Plugin not found: ${id}`);
    const updated: PluginEntity = { ...plugin, ...updates, updatedAt: new Date() };
    this.plugins.set(id, updated);
    return updated;
  }

  // ─── Manifests ────────────────────────────────────────────────────────────

  async createManifest(entity: Omit<PluginManifestEntity, 'createdAt'>): Promise<PluginManifestEntity> {
    const manifest: PluginManifestEntity = { ...entity, createdAt: new Date() };
    this.manifests.set(manifest.id, manifest);
    return manifest;
  }

  async findManifestByPluginAndVersion(pluginId: string, version: string): Promise<PluginManifestEntity | null> {
    for (const manifest of this.manifests.values()) {
      if (manifest.pluginId === pluginId && manifest.version === version) return manifest;
    }
    return null;
  }

  // ─── Installs ─────────────────────────────────────────────────────────────

  async createInstall(entity: Omit<PluginInstallEntity, 'installedAt' | 'enabledAt' | 'disabledAt' | 'uninstalledAt' | 'updatedAt'>): Promise<PluginInstallEntity> {
    const now = new Date();
    const install: PluginInstallEntity = {
      ...entity,
      installedAt: now,
      enabledAt: null,
      disabledAt: null,
      uninstalledAt: null,
      updatedAt: now,
    };
    this.installs.set(install.id, install);
    return install;
  }

  async findInstallById(id: string): Promise<PluginInstallEntity | null> {
    return this.installs.get(id) ?? null;
  }

  async findInstallByPluginAndTenant(pluginId: string, tenantId: string): Promise<PluginInstallEntity | null> {
    for (const install of this.installs.values()) {
      if (install.pluginId === pluginId && install.tenantId === tenantId && install.status !== 'uninstalled') {
        return install;
      }
    }
    return null;
  }

  async listInstallsByTenant(tenantId: string): Promise<PluginInstallEntity[]> {
    return Array.from(this.installs.values()).filter(
      (i) => i.tenantId === tenantId && i.status !== 'uninstalled',
    );
  }

  async updateInstall(id: string, updates: Partial<Pick<PluginInstallEntity, 'status' | 'configuration' | 'enabledAt' | 'disabledAt' | 'uninstalledAt'>>): Promise<PluginInstallEntity> {
    const install = this.installs.get(id);
    if (!install) throw new Error(`Install not found: ${id}`);
    const updated: PluginInstallEntity = { ...install, ...updates, updatedAt: new Date() };
    this.installs.set(id, updated);
    return updated;
  }

  // ─── Permissions ──────────────────────────────────────────────────────────

  async createPermissions(entities: Omit<PluginPermissionEntity, 'revokedAt' | 'revokedBy'>[]): Promise<PluginPermissionEntity[]> {
    const results: PluginPermissionEntity[] = [];
    for (const entity of entities) {
      const permission: PluginPermissionEntity = { ...entity, revokedAt: null, revokedBy: null };
      this.permissions.set(permission.id, permission);
      results.push(permission);
    }
    return results;
  }

  async findPermissionsByInstall(installId: string): Promise<PluginPermissionEntity[]> {
    return Array.from(this.permissions.values()).filter((p) => p.installId === installId);
  }

  async revokePermission(id: string, revokedBy: string): Promise<PluginPermissionEntity> {
    const permission = this.permissions.get(id);
    if (!permission) throw new Error(`Permission not found: ${id}`);
    const updated: PluginPermissionEntity = {
      ...permission,
      status: 'revoked',
      revokedAt: new Date(),
      revokedBy,
    };
    this.permissions.set(id, updated);
    return updated;
  }

  async revokeAllPermissionsByInstall(installId: string, revokedBy: string): Promise<void> {
    for (const [id, permission] of this.permissions.entries()) {
      if (permission.installId === installId && permission.status === 'consented') {
        this.permissions.set(id, {
          ...permission,
          status: 'revoked',
          revokedAt: new Date(),
          revokedBy,
        });
      }
    }
  }

  // ─── Audit ────────────────────────────────────────────────────────────────

  async createAuditEntry(entry: Omit<PluginAuditEntry, 'timestamp'>): Promise<PluginAuditEntry> {
    const auditEntry: PluginAuditEntry = { ...entry, timestamp: new Date() };
    this.auditEntries.push(auditEntry);
    return auditEntry;
  }

  async listAuditEntries(pluginId: string, tenantId: string): Promise<PluginAuditEntry[]> {
    return this.auditEntries.filter((e) => e.pluginId === pluginId && e.tenantId === tenantId);
  }
}
