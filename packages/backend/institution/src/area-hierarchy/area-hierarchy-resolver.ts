/**
 * W1-ARCH-04 (D6) — tenant-scoped, data-driven area hierarchy resolver.
 *
 * Replaces the gateway's former hardcoded single `{ id: 'root' }` node with
 * per-tenant trees loaded from `geographic_areas` (Postgres) or registered
 * explicitly for in-memory / test composition.
 */
import type { AreaHierarchyResolver, AreaNode } from '@proctira/auth';
import { getSharedPgPool, withPgTenant } from '@proctira/database';

/** Minimal shape for registering areas from seeds or API writes. */
export interface RegisterableArea {
  id: string;
  parentId: string | null;
  level: number;
}

/** Build materialized paths for RBAC descendant checks. */
export function toAreaNodes(areas: RegisterableArea[]): AreaNode[] {
  const byId = new Map(areas.map((area) => [area.id, area]));
  return areas.map((area) => {
    const segments: string[] = [];
    let current: RegisterableArea | undefined = area;
    while (current) {
      segments.unshift(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return {
      id: area.id,
      parentId: area.parentId,
      level: area.level,
      path: `/${segments.join('/')}`,
    };
  });
}

/**
 * Tenant-partitioned resolver backing RBAC area scoping.
 * Unknown areas are not treated as descendants of a synthetic root.
 */
export class TenantScopedAreaHierarchyResolver implements AreaHierarchyResolver {
  private readonly byTenant = new Map<string, Map<string, AreaNode>>();
  private readonly areaToTenant = new Map<string, string>();
  private readonly loadedTenants = new Set<string>();

  /** Register or replace a tenant's hierarchy (in-memory / test / write-through). */
  registerTenantAreas(tenantId: string, areas: RegisterableArea[]): void {
    const nodes = toAreaNodes(areas);
    const index = new Map<string, AreaNode>();
    for (const node of nodes) {
      index.set(node.id, node);
      this.areaToTenant.set(node.id, tenantId);
    }
    this.byTenant.set(tenantId, index);
    this.loadedTenants.add(tenantId);
  }

  /** True when the resolver only knows the legacy synthetic root id. */
  isHardcodedRootOnly(): boolean {
    if (this.byTenant.size !== 1) return false;
    const only = [...this.byTenant.values()][0];
    return only?.size === 1 && only.has('root');
  }

  async isDescendantOrSelf(targetAreaId: string, ancestorAreaId: string): Promise<boolean> {
    if (targetAreaId === ancestorAreaId) return true;
    if (!ancestorAreaId) return true;

    const target = await this.resolveNode(targetAreaId);
    const ancestor = await this.resolveNode(ancestorAreaId);
    if (!target || !ancestor) return false;
    if (this.areaToTenant.get(target.id) !== this.areaToTenant.get(ancestor.id)) return false;

    return target.path === ancestor.path || target.path.startsWith(`${ancestor.path}/`);
  }

  /** Load a tenant tree from Postgres (no-op when already loaded or in-memory). */
  async ensureTenantLoaded(tenantId: string): Promise<void> {
    await this.tenantIndex(tenantId);
  }

  async getAncestors(areaId: string): Promise<string[]> {
    const node = await this.resolveNode(areaId);
    if (!node) return [];

    const tenantId = this.areaToTenant.get(node.id);
    if (!tenantId) return [node.id];

    const index = await this.tenantIndex(tenantId);
    const ancestors: string[] = [];
    let current: AreaNode | undefined = node;
    const visited = new Set<string>();

    while (current) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      ancestors.unshift(current.id);
      current = current.parentId ? index.get(current.parentId) : undefined;
    }

    return ancestors;
  }

  private async resolveNode(areaId: string): Promise<AreaNode | undefined> {
    const tenantId = this.areaToTenant.get(areaId);
    if (tenantId) {
      return (await this.tenantIndex(tenantId)).get(areaId);
    }
    for (const index of this.byTenant.values()) {
      const node = index.get(areaId);
      if (node) return node;
    }
    return undefined;
  }

  private async tenantIndex(tenantId: string): Promise<Map<string, AreaNode>> {
    if (!this.loadedTenants.has(tenantId)) {
      await this.loadTenantFromDatabase(tenantId);
    }
    return this.byTenant.get(tenantId) ?? new Map();
  }

  private async loadTenantFromDatabase(tenantId: string): Promise<void> {
    const pool = getSharedPgPool();
    if (!pool) {
      this.byTenant.set(tenantId, new Map());
      this.loadedTenants.add(tenantId);
      return;
    }

    const rows = await withPgTenant(pool, tenantId, async (client) => {
      const result = await client.query<{
        id: string;
        parent_id: string | null;
        level: number;
      }>(
        `SELECT id, parent_id, level
         FROM geographic_areas
         WHERE tenant_id = $1::uuid AND deleted_at IS NULL`,
        [tenantId],
      );
      return result.rows;
    });

    this.registerTenantAreas(
      tenantId,
      rows.map((row) => ({
        id: row.id,
        parentId: row.parent_id,
        level: row.level,
      })),
    );
  }
}
