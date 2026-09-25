/**
 * Live Postgres proof that the area hierarchy works under FORCE ROW LEVEL
 * SECURITY through the tenant-bound Prisma client.
 *
 * These routes were defined with 38 passing unit tests but were never mounted:
 * `institutionPlugin` registered them only when a caller passed
 * `areaHierarchyDb`, and `apps/api-gateway` never did. They are now mounted on
 * `deps.prisma`, which is `createTenantBoundPrisma(...)`, so every
 * `geographicArea` operation must run inside `withTenantTransaction` and bind
 * `app.tenant_id`. Without that binding these writes fail with 42501 under the
 * non-owner runtime role, exactly as the academics services once did.
 *
 * This also guards the reason the mount matters: `institutions.area_id` is a
 * real foreign key to `geographic_areas(id)`, so the UI cannot invent area ids.
 *
 * Skips cleanly when DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';

import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, describe, expect, it } from 'vitest';

import { createTenantBoundPrisma } from '../tenant-bound-prisma.js';
import { tenantContext } from '../tenant-context.js';
import { AreaHierarchyService } from './area-hierarchy.service.js';
import type { AreaHierarchyDbClient } from './area-hierarchy.service.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'area-hierarchy-prisma.live.test' });

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
  const tenantA = randomUUID();
  const tenantB = randomUUID();

  function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId }, fn);
  }

  function service(): AreaHierarchyService {
    return new AreaHierarchyService(
      createTenantBoundPrisma(prisma!) as unknown as AreaHierarchyDbClient,
    );
  }

  afterAll(async () => {
    if (!prisma) return;
    for (const tenantId of [tenantA, tenantB]) {
      await withTenant(tenantId, () =>
        createTenantBoundPrisma(prisma).geographicArea.deleteMany({ where: { tenantId } }),
      );
    }
    await prisma.$disconnect();
  });

  it('creates an area and reads it back in the request tenant', async () => {
    await seedTenant(tenantA);
    const code = `AREA-${Date.now().toString(36)}`;

    const created = await withTenant(tenantA, () =>
      service().create({ tenantId: tenantA, name: `Live ${code}`, code }),
    );
    expect(created.id).toBeTruthy();

    const tree = await withTenant(tenantA, () => service().getTree(tenantA));
    expect(tree.map((node) => node.id)).toContain(created.id);
  });

  it('hides another tenant\u2019s areas from the tree (RLS, not just a where clause)', async () => {
    await seedTenant(tenantA);
    await seedTenant(tenantB);

    const mine = await withTenant(tenantA, () =>
      service().create({
        tenantId: tenantA,
        name: 'Tenant A District',
        code: `A-${Date.now().toString(36)}`,
      }),
    );

    const otherTree = await withTenant(tenantB, () => service().getTree(tenantB));
    expect(otherTree.map((node) => node.id)).not.toContain(mine.id);
  });

  it('returns a nested subtree, proving the lft/rgt range filter is applied', async () => {
    await seedTenant(tenantA);
    const stamp = Date.now().toString(36);

    const root = await withTenant(tenantA, () =>
      service().create({ tenantId: tenantA, name: 'State', code: `ST-${stamp}` }),
    );
    const child = await withTenant(tenantA, () =>
      service().create({
        tenantId: tenantA,
        name: 'District',
        code: `DI-${stamp}`,
        parentId: root.id,
      }),
    );

    const subtree = await withTenant(tenantA, () => service().getTree(tenantA, root.id));
    const flat: string[] = [];
    const walk = (nodes: { id: string; children?: unknown }[]) => {
      for (const node of nodes) {
        flat.push(node.id);
        const kids = (node as { children?: { id: string }[] }).children;
        if (kids?.length) walk(kids);
      }
    };
    walk(subtree as { id: string; children?: unknown }[]);

    expect(flat).toContain(root.id);
    expect(flat).toContain(child.id);
  });

  it('keeps institutions.area_id referential: an invented area id cannot be used', async () => {
    await seedTenant(tenantA);
    const pool = getSharedPgPool(DATABASE_URL);
    expect(pool).not.toBeNull();

    // The exact id the removed `FALLBACK_AREAS` offered as "National".
    const inventedAreaId = '00000000-0000-4000-8000-000000000001';

    await expect(
      withPgTenant(pool!, tenantA, async (client) => {
        await client.query(
          `INSERT INTO institutions (tenant_id, name, code, area_id, type, sector, ownership)
           VALUES ($1, $2, $3, $4, 'K12', 'GOVERNMENT', 'CENTRAL')`,
          [tenantA, 'Invented Area School', `INV-${Date.now().toString(36)}`, inventedAreaId],
        );
      }),
    ).rejects.toThrow(/foreign key constraint|violates/i);
  });
});
