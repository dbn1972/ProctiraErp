/**
 * PRC-L119 — area create/move must be reflected by the RBAC resolver without a restart.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { TenantScopedAreaHierarchyResolver } from './area-hierarchy-resolver.js';
import { AreaHierarchyService } from './area-hierarchy.service.js';
import { InMemoryAreaHierarchyDb } from './create-area-hierarchy-db.js';

const TENANT = '11111111-1111-4111-8111-111111111111';

describe('PRC-L119 resolver invalidation', () => {
  const resolvers: TenantScopedAreaHierarchyResolver[] = [];
  afterEach(() => {
    for (const r of resolvers.splice(0)) r.dispose();
  });

  function setup(options: { ttlMs?: number; now?: () => number } = {}) {
    const db = new InMemoryAreaHierarchyDb();
    const service = new AreaHierarchyService(db);
    let loads = 0;
    const resolver = new TenantScopedAreaHierarchyResolver({
      ...options,
      loader: async (tenantId) => {
        loads += 1;
        const rows = await db.geographicArea.findMany({ where: { tenantId, deletedAt: null } });
        return rows.map((r) => ({ id: r.id, parentId: r.parentId, level: r.level }));
      },
    });
    resolvers.push(resolver);
    return { service, resolver, loads: () => loads };
  }

  it('move then isDescendantOrSelf reflects the new ancestry', async () => {
    const { service, resolver } = setup({ ttlMs: 3_600_000 });
    const a = await service.create({ tenantId: TENANT, name: 'A', code: 'A' });
    const b = await service.create({ tenantId: TENANT, name: 'B', code: 'B' });
    const child = await service.create({ tenantId: TENANT, name: 'C', code: 'C', parentId: a.id });

    await resolver.ensureTenantLoaded(TENANT);
    expect(await resolver.isDescendantOrSelf(child.id, a.id)).toBe(true);
    expect(await resolver.isDescendantOrSelf(child.id, b.id)).toBe(false);

    await service.move(TENANT, child.id, { newParentId: b.id });
    await resolver.ensureTenantLoaded(TENANT);

    expect(await resolver.isDescendantOrSelf(child.id, b.id)).toBe(true);
    expect(await resolver.isDescendantOrSelf(child.id, a.id)).toBe(false);
  });

  it('newly created areas become resolvable after create', async () => {
    const { service, resolver } = setup({ ttlMs: 3_600_000 });
    const root = await service.create({ tenantId: TENANT, name: 'R', code: 'R' });
    await resolver.ensureTenantLoaded(TENANT);
    const leaf = await service.create({
      tenantId: TENANT,
      name: 'L',
      code: 'L',
      parentId: root.id,
    });
    await resolver.ensureTenantLoaded(TENANT);
    expect(await resolver.isDescendantOrSelf(leaf.id, root.id)).toBe(true);
  });

  it('reloads store-backed trees after the TTL (cross-replica convergence)', async () => {
    let clock = 0;
    const { resolver, loads } = setup({ ttlMs: 1000, now: () => clock });
    await resolver.ensureTenantLoaded(TENANT);
    await resolver.ensureTenantLoaded(TENANT);
    expect(loads()).toBe(1);
    clock = 1500;
    await resolver.ensureTenantLoaded(TENANT);
    expect(loads()).toBe(2);
  });
});
