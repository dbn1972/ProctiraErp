/**
 * PRC-L119 — shared area-tree version stamp: an area move written through one replica is
 * reflected by another replica's RBAC resolver within the stamp check interval, long before the
 * cache TTL, without any in-process notification reaching it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TenantScopedAreaHierarchyResolver,
  publishAreaHierarchyChanged,
} from './area-hierarchy-resolver.js';
import {
  MemoryAreaHierarchyVersionStore,
  RedisAreaHierarchyVersionStore,
  configureAreaHierarchyVersionStore,
  type AreaHierarchyVersionStore,
} from './area-hierarchy-version.js';
import { AreaHierarchyService } from './area-hierarchy.service.js';
import { InMemoryAreaHierarchyDb } from './create-area-hierarchy-db.js';

const TENANT = '22222222-2222-4222-8222-222222222222';

describe('PRC-L119 shared area-tree version stamp', () => {
  const resolvers: TenantScopedAreaHierarchyResolver[] = [];
  afterEach(() => {
    for (const r of resolvers.splice(0)) r.dispose();
    configureAreaHierarchyVersionStore(undefined);
  });

  function replica(
    db: InMemoryAreaHierarchyDb,
    versionStore: AreaHierarchyVersionStore,
    clock: () => number,
  ) {
    const resolver = new TenantScopedAreaHierarchyResolver({
      ttlMs: 3_600_000,
      versionCheckMs: 1000,
      versionStore,
      now: clock,
      loader: async (tenantId) => {
        const rows = await db.geographicArea.findMany({ where: { tenantId, deletedAt: null } });
        return rows.map((r) => ({ id: r.id, parentId: r.parentId, level: r.level }));
      },
    });
    resolvers.push(resolver);
    return resolver;
  }

  it('a move on replica A is seen by replica B after the stamp check, not the TTL', async () => {
    let clock = 0;
    const db = new InMemoryAreaHierarchyDb();
    const shared = new MemoryAreaHierarchyVersionStore();
    const service = new AreaHierarchyService(db);
    const a = await service.create({ tenantId: TENANT, name: 'A', code: 'A' });
    const b = await service.create({ tenantId: TENANT, name: 'B', code: 'B' });
    const child = await service.create({ tenantId: TENANT, name: 'C', code: 'C', parentId: a.id });
    const replicaB = replica(db, shared, () => clock);
    await replicaB.ensureTenantLoaded(TENANT);
    expect(await replicaB.isDescendantOrSelf(child.id, a.id)).toBe(true);
    // Replica B is another process: drop it from in-process notifications so only the shared
    // stamp can tell it about the change.
    replicaB.dispose();
    await db.geographicArea.update({ where: { id: child.id }, data: { parentId: b.id } });
    await publishAreaHierarchyChanged(TENANT, shared);
    // Within the check interval the cached tree is still used.
    clock = 500;
    expect(await replicaB.isDescendantOrSelf(child.id, a.id)).toBe(true);
    clock = 1500;
    expect(await replicaB.isDescendantOrSelf(child.id, b.id)).toBe(true);
    expect(await replicaB.isDescendantOrSelf(child.id, a.id)).toBe(false);
  });

  it('AreaHierarchyService bumps the configured shared store on create and move', async () => {
    const shared = new MemoryAreaHierarchyVersionStore();
    configureAreaHierarchyVersionStore(shared);
    const service = new AreaHierarchyService(new InMemoryAreaHierarchyDb());
    expect(await shared.current(TENANT)).toBeNull();
    const a = await service.create({ tenantId: TENANT, name: 'A', code: 'A' });
    const b = await service.create({ tenantId: TENANT, name: 'B', code: 'B' });
    expect(await shared.current(TENANT)).toBe('2');
    await service.move(TENANT, a.id, { newParentId: b.id });
    expect(await shared.current(TENANT)).toBe('3');
  });

  it('an unreadable stamp reloads from the database instead of trusting the cache', async () => {
    let clock = 0;
    let loads = 0;
    const flaky: AreaHierarchyVersionStore = {
      current: vi.fn().mockResolvedValueOnce('1').mockRejectedValue(new Error('redis down')),
      bump: vi.fn(),
    };
    const resolver = new TenantScopedAreaHierarchyResolver({
      ttlMs: 3_600_000,
      versionCheckMs: 1000,
      versionStore: flaky,
      now: () => clock,
      loader: async () => {
        loads += 1;
        return [];
      },
    });
    resolvers.push(resolver);
    await resolver.ensureTenantLoaded(TENANT);
    expect(loads).toBe(1);
    clock = 1500;
    await resolver.ensureTenantLoaded(TENANT);
    expect(loads).toBe(2);
  });

  it('a failed shared bump never fails the committed write', async () => {
    const failing: AreaHierarchyVersionStore = {
      current: async () => null,
      bump: async () => {
        throw new Error('redis down');
      },
    };
    await expect(publishAreaHierarchyChanged(TENANT, failing)).resolves.toBe(false);
  });

  it('Redis store uses a tenant-scoped INCR/GET key', async () => {
    const redis = { get: vi.fn().mockResolvedValue('7'), incr: vi.fn().mockResolvedValue(8) };
    const store = new RedisAreaHierarchyVersionStore(redis);
    await store.bump(TENANT);
    await expect(store.current(TENANT)).resolves.toBe('7');
    expect(redis.incr).toHaveBeenCalledWith(`t:${TENANT}:area-hierarchy:version`);
    expect(redis.get).toHaveBeenCalledWith(`t:${TENANT}:area-hierarchy:version`);
  });
});
