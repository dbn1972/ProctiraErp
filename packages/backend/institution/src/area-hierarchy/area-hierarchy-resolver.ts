/**
 * W1-ARCH-04 (D6) — tenant-scoped, data-driven area hierarchy resolver.
 *
 * Replaces the gateway's former hardcoded single `{ id: 'root' }` node with
 * per-tenant trees loaded from `geographic_areas` (Postgres) or registered
 * explicitly for in-memory / test composition.
 */
import type { AreaHierarchyResolver, AreaNode } from '@proctira/auth';
import { getSharedPgPool, withPgTenant } from '@proctira/database';

import {
  getAreaHierarchyVersionStore,
  type AreaHierarchyVersionStore,
} from './area-hierarchy-version.js';

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

/** Default lifetime of a database-loaded tenant tree before it is reloaded (PRC-L119). */
export const DEFAULT_AREA_HIERARCHY_TTL_MS = 60_000;

/** Loads a tenant's areas from the backing store; `undefined` means no store is available. */
export type AreaHierarchyLoader = (tenantId: string) => Promise<RegisterableArea[] | undefined>;

export interface TenantScopedAreaHierarchyResolverOptions {
  /** Max age of a store-loaded tenant tree (ms). Bounds cross-replica staleness. */
  ttlMs?: number;
  /** Override the Postgres loader (tests / alternative stores). */
  loader?: AreaHierarchyLoader;
  /** Clock override for tests. */
  now?: () => number;
  /**
   * PRC-L119: shared per-tenant version stamp. Defaults to the store installed with
   * `configureAreaHierarchyVersionStore` (Redis at gateway boot). `null` disables it.
   */
  versionStore?: AreaHierarchyVersionStore | null;
  /** How often a cached tree's stamp is re-read (ms). Default 1000. */
  versionCheckMs?: number;
}

/** Live resolvers in this process, notified when an area write changes a tenant tree. */
const liveResolvers = new Set<TenantScopedAreaHierarchyResolver>();

/**
 * Invalidate every in-process resolver's cached tree for a tenant (PRC-L119).
 * Synchronous, local only; prefer {@link publishAreaHierarchyChanged}, which also bumps the
 * shared version stamp so other replicas reload too.
 */
export function notifyAreaHierarchyChanged(tenantId: string): void {
  for (const resolver of liveResolvers) resolver.invalidateTenant(tenantId);
}

/**
 * PRC-L119: called by AreaHierarchyService after create/update/move. Invalidates this process's
 * resolvers and bumps the shared version stamp so every replica reloads the tenant tree on its
 * next stamp check. Returns false when the shared bump failed (replicas then converge within
 * the TTL); the committed area write is never failed for it.
 */
export async function publishAreaHierarchyChanged(
  tenantId: string,
  store: AreaHierarchyVersionStore | undefined = getAreaHierarchyVersionStore(),
): Promise<boolean> {
  notifyAreaHierarchyChanged(tenantId);
  if (!store) return true;
  try {
    await store.bump(tenantId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tenant-partitioned resolver backing RBAC area scoping.
 * Unknown areas are not treated as descendants of a synthetic root.
 */
export class TenantScopedAreaHierarchyResolver implements AreaHierarchyResolver {
  private readonly byTenant = new Map<string, Map<string, AreaNode>>();
  private readonly areaToTenant = new Map<string, string>();
  private readonly loadedTenants = new Set<string>();
  /** Load timestamps for store-backed tenants; explicitly registered trees never expire. */
  private readonly storeLoadedAt = new Map<string, number>();
  private readonly ttlMs: number;
  private readonly loader: AreaHierarchyLoader;
  private readonly now: () => number;
  private readonly versionStoreOption: AreaHierarchyVersionStore | null | undefined;
  private readonly versionCheckMs: number;
  /** Stamp observed when each store-loaded tenant tree was loaded, and when it was last read. */
  private readonly loadedVersion = new Map<string, string | null>();
  private readonly versionCheckedAt = new Map<string, number>();
  constructor(options: TenantScopedAreaHierarchyResolverOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_AREA_HIERARCHY_TTL_MS;
    this.loader = options.loader ?? loadTenantAreasFromPostgres;
    this.now = options.now ?? Date.now;
    this.versionStoreOption = options.versionStore;
    this.versionCheckMs = options.versionCheckMs ?? 1000;
    liveResolvers.add(this);
  }

  private get versionStore(): AreaHierarchyVersionStore | undefined {
    if (this.versionStoreOption === null) return undefined;
    return this.versionStoreOption ?? getAreaHierarchyVersionStore();
  }

  /** Register or replace a tenant's hierarchy (in-memory / test / write-through). */
  registerTenantAreas(tenantId: string, areas: RegisterableArea[]): void {
    this.replaceTenant(tenantId, areas);
    this.storeLoadedAt.delete(tenantId);
  }

  /** Drop a store-loaded tenant tree so the next lookup reloads it. */
  invalidateTenant(tenantId: string): void {
    if (!this.storeLoadedAt.has(tenantId)) return;
    this.loadedTenants.delete(tenantId);
    this.storeLoadedAt.delete(tenantId);
  }

  /** Stop receiving change notifications (tests / shutdown). */
  dispose(): void {
    liveResolvers.delete(this);
  }

  private replaceTenant(tenantId: string, areas: RegisterableArea[]): void {
    const previous = this.byTenant.get(tenantId);
    if (previous) {
      for (const id of previous.keys()) {
        if (this.areaToTenant.get(id) === tenantId) this.areaToTenant.delete(id);
      }
    }
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
    const loadedAt = this.storeLoadedAt.get(tenantId);
    const expired = loadedAt !== undefined && this.now() - loadedAt >= this.ttlMs;
    if (
      !this.loadedTenants.has(tenantId) ||
      expired ||
      (loadedAt !== undefined && (await this.sharedVersionChanged(tenantId)))
    ) {
      await this.loadTenantFromStore(tenantId);
    }
    return this.byTenant.get(tenantId) ?? new Map();
  }

  /**
   * PRC-L119: true when another replica bumped the tenant's stamp since this tree was loaded.
   * Read at most every `versionCheckMs`; an unreadable stamp counts as changed (reload from the
   * database rather than keep a possibly stale RBAC tree).
   */
  private async sharedVersionChanged(tenantId: string): Promise<boolean> {
    const store = this.versionStore;
    if (!store) return false;
    const checkedAt = this.versionCheckedAt.get(tenantId);
    if (checkedAt !== undefined && this.now() - checkedAt < this.versionCheckMs) return false;
    this.versionCheckedAt.set(tenantId, this.now());
    try {
      return (await store.current(tenantId)) !== (this.loadedVersion.get(tenantId) ?? null);
    } catch {
      return true;
    }
  }

  private async loadTenantFromStore(tenantId: string): Promise<void> {
    // Read the stamp before the tree so a bump racing the load triggers the next reload.
    let version: string | null = null;
    const store = this.versionStore;
    if (store) {
      try {
        version = await store.current(tenantId);
      } catch {
        version = null;
      }
    }
    const areas = await this.loader(tenantId);
    if (!areas) {
      if (!this.byTenant.has(tenantId)) this.byTenant.set(tenantId, new Map());
      this.loadedTenants.add(tenantId);
      return;
    }
    this.replaceTenant(tenantId, areas);
    this.storeLoadedAt.set(tenantId, this.now());
    this.loadedVersion.set(tenantId, version);
    this.versionCheckedAt.set(tenantId, this.now());
  }
}

async function loadTenantAreasFromPostgres(
  tenantId: string,
): Promise<RegisterableArea[] | undefined> {
  const pool = getSharedPgPool();
  if (!pool) return undefined;

  type GeographicAreaRow = {
    id: string;
    parent_id: string | null;
    level: number;
  };
  const rows = await withPgTenant(pool, tenantId, async (client) => {
    const result = await client.query(
      `SELECT id, parent_id, level
       FROM geographic_areas
       WHERE tenant_id = $1::uuid AND deleted_at IS NULL`,
      [tenantId],
    );
    return result.rows as GeographicAreaRow[];
  });
  return rows.map((row) => ({ id: row.id, parentId: row.parent_id, level: row.level }));
}
