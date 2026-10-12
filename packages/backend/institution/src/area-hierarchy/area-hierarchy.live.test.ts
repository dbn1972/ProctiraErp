/**
 * #597 review — live Postgres proof that area-hierarchy tree rewrites run under
 * FORCE ROW LEVEL SECURITY through the tenant-bound Prisma client.
 *
 * `create`/`move` run inside `$transaction`. The tenant-bound client used to pass
 * `$transaction` through raw, so the callback ran with no `app.tenant_id`: a root
 * create failed the RLS WITH CHECK and child create / move returned 404.
 * Also proves `move()` refuses a cycle even when the nested-set coordinates are
 * stale (pre-PRC-M281 data), because the descendant check uses the path.
 *
 * Skips cleanly when DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import { afterAll, describe, expect, it } from 'vitest';

import { createTenantBoundPrisma } from '../tenant-bound-prisma.js';
import { tenantContext } from '../tenant-context.js';
import { AreaHierarchyService, type AreaHierarchyDbClient } from './area-hierarchy.service.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'area-hierarchy.live.test' });

async function seedTenant(tenantId: string): Promise<void> {
  const pool = getSharedPgPool(DATABASE_URL);
  expect(pool).not.toBeNull();
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `area-${tenantId.slice(0, 8)}`, `area-${tenantId}`],
    );
  });
}

describe.skipIf(!DATABASE_URL)('area hierarchy under FORCE RLS (live Postgres)', () => {
  const prisma = DATABASE_URL ? createPrismaClient({ datasourceUrl: DATABASE_URL }) : null;
  const bound = prisma ? createTenantBoundPrisma(prisma) : null;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const service = new AreaHierarchyService(bound as unknown as AreaHierarchyDbClient);
  const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    tenantContext.run({ tenantId }, fn);
  const suffix = Date.now().toString(36);

  afterAll(async () => {
    if (!bound || !prisma) return;
    await asTenant(tenantA, () =>
      bound.geographicArea.deleteMany({ where: { tenantId: tenantA } }),
    );
    await prisma.$disconnect();
  });

  it('creates root and child, moves a subtree, and keeps tenants apart', async () => {
    await seedTenant(tenantA);
    await seedTenant(tenantB);

    const state = await asTenant(tenantA, () =>
      service.create({ tenantId: tenantA, name: 'State', code: `ST-${suffix}` }),
    );
    const district = await asTenant(tenantA, () =>
      service.create({
        tenantId: tenantA,
        name: 'District',
        code: `DI-${suffix}`,
        parentId: state.id,
      }),
    );
    const other = await asTenant(tenantA, () =>
      service.create({ tenantId: tenantA, name: 'Other', code: `OT-${suffix}` }),
    );
    expect(district.parentId).toBe(state.id);
    expect(district.level).toBe(1);

    const moved = await asTenant(tenantA, () =>
      service.move(tenantA, district.id, { newParentId: other.id }),
    );
    expect(moved.parentId).toBe(other.id);
    expect(moved.path).toBe(`/${other.id}`);

    const subtree = await asTenant(tenantA, () => service.getTree(tenantA, other.id));
    expect(subtree.map((n) => n.id)).toEqual([other.id]);
    expect(subtree[0]!.children.map((n) => n.id)).toEqual([district.id]);

    const seenByB = await asTenant(tenantB, () => service.getTree(tenantB));
    expect(seenByB).toEqual([]);
  });

  it('refuses to move an area under its own descendant even with stale lft/rgt', async () => {
    const root = await asTenant(tenantA, () =>
      service.create({ tenantId: tenantA, name: 'Root', code: `RT-${suffix}` }),
    );
    const child = await asTenant(tenantA, () =>
      service.create({
        tenantId: tenantA,
        name: 'Child',
        code: `CH-${suffix}`,
        parentId: root.id,
      }),
    );
    // Simulate pre-PRC-M281 data: coordinates that no longer nest the child.
    await asTenant(tenantA, () =>
      bound!.geographicArea.update({ where: { id: child.id }, data: { lft: 900, rgt: 901 } }),
    );

    await expect(
      asTenant(tenantA, () => service.move(tenantA, root.id, { newParentId: child.id })),
    ).rejects.toThrow(/own descendants/);

    const after = await asTenant(tenantA, () => service.getById(tenantA, root.id));
    expect(after.parentId).toBeNull();
  });
});
