/**
 * PRC-L119 — shared area-tree version stamp.
 *
 * Every area create/update/move bumps a per-tenant version in a store shared by all gateway
 * replicas (Redis in production, via the gateway's shared client). The RBAC area resolver
 * compares the stamp it loaded with the current one at most every `versionCheckMs` and reloads
 * the tenant tree when they differ, so ancestry changes made on one replica are seen by every
 * replica within about a second instead of only after the cache TTL.
 */

export interface AreaHierarchyVersionStore {
  /** Current version stamp for the tenant tree (null when never bumped). */
  current(tenantId: string): Promise<string | null>;
  /** Record that the tenant tree changed. */
  bump(tenantId: string): Promise<void>;
}

/** Process-local store: tests and single-process dev only. */
export class MemoryAreaHierarchyVersionStore implements AreaHierarchyVersionStore {
  private readonly versions = new Map<string, number>();

  async current(tenantId: string): Promise<string | null> {
    const value = this.versions.get(tenantId);
    return value === undefined ? null : String(value);
  }

  async bump(tenantId: string): Promise<void> {
    this.versions.set(tenantId, (this.versions.get(tenantId) ?? 0) + 1);
  }
}

/** Minimal ioredis-compatible surface. */
export interface RedisLikeForAreaHierarchyVersion {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
}

/** Redis-backed stamp shared by every replica; keys are tenant-scoped (`t:<tenant>:…`). */
export class RedisAreaHierarchyVersionStore implements AreaHierarchyVersionStore {
  constructor(private readonly redis: RedisLikeForAreaHierarchyVersion) {}

  private key(tenantId: string): string {
    return `t:${tenantId}:area-hierarchy:version`;
  }

  async current(tenantId: string): Promise<string | null> {
    return this.redis.get(this.key(tenantId));
  }

  async bump(tenantId: string): Promise<void> {
    await this.redis.incr(this.key(tenantId));
  }
}

let sharedVersionStore: AreaHierarchyVersionStore | undefined;

/** Install (or clear) the process-wide shared version store. Called once at gateway boot. */
export function configureAreaHierarchyVersionStore(
  store: AreaHierarchyVersionStore | undefined,
): void {
  sharedVersionStore = store;
}

export function getAreaHierarchyVersionStore(): AreaHierarchyVersionStore | undefined {
  return sharedVersionStore;
}
