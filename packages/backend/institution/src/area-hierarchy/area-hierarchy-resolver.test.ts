/**
 * W1-ARCH-04 (D6) — area hierarchy resolver must be tenant-scoped, not a hardcoded root.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { InMemoryAreaHierarchyResolver, evaluatePermission } from '@proctira/auth';
import { describe, expect, it } from 'vitest';

import {
  TenantScopedAreaHierarchyResolver,
  toAreaNodes,
} from './area-hierarchy-resolver.js';
import {
  createAreaHierarchyResolver,
  demoGatewayAreaHierarchy,
  GATEWAY_DEMO_TENANT_ID,
} from './create-area-hierarchy-resolver.js';

delete process.env['DATABASE_URL'];

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const gatewayAppPath = join(repoRoot, 'apps/api-gateway/src/app.ts');

const LEGACY_HARDCODED_ROOT = [
  { id: 'root', parentId: null, level: 0, path: '/root' },
] as const;

describe('W1-ARCH-04 (D6) hardcoded root regression', () => {
  it('proves legacy single-root resolver cannot scope real tenant UUID areas', async () => {
    const legacy = new InMemoryAreaHierarchyResolver([...LEGACY_HARDCODED_ROOT]);
    const [country, state, district] = demoGatewayAreaHierarchy();

    expect(await legacy.isDescendantOrSelf(district.id, state.id)).toBe(false);
    expect(await legacy.isDescendantOrSelf(district.id, country.id)).toBe(false);
    expect(await legacy.getAncestors(district.id)).toEqual([district.id]);
    expect(await legacy.isDescendantOrSelf('root', 'root')).toBe(true);
  });

  it('tenant-scoped resolver resolves descendants within the registered tenant tree', async () => {
    const resolver = new TenantScopedAreaHierarchyResolver();
    resolver.registerTenantAreas(GATEWAY_DEMO_TENANT_ID, demoGatewayAreaHierarchy());

    const [country, state, district] = demoGatewayAreaHierarchy();
    expect(await resolver.isDescendantOrSelf(district.id, state.id)).toBe(true);
    expect(await resolver.isDescendantOrSelf(district.id, country.id)).toBe(true);
    expect(await resolver.isDescendantOrSelf(state.id, district.id)).toBe(false);
    expect(await resolver.getAncestors(district.id)).toEqual([
      country.id,
      state.id,
      district.id,
    ]);
  });

  it('keeps tenant trees isolated', async () => {
    const resolver = new TenantScopedAreaHierarchyResolver();
    const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const areaA = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', parentId: null, level: 1 };
    const areaB = { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', parentId: null, level: 1 };
    resolver.registerTenantAreas(tenantA, [areaA]);
    resolver.registerTenantAreas(tenantB, [areaB]);

    expect(await resolver.isDescendantOrSelf(areaA.id, areaB.id)).toBe(false);
  });

  it('RBAC grants area-scoped access when resolver knows the tenant hierarchy', async () => {
    const resolver = createAreaHierarchyResolver();
    const [, state, district] = demoGatewayAreaHierarchy();
    const registry = {
      roleHasPermission: () => true,
    };

    const denied = await evaluatePermission(
      {
        userId: 'u1',
        tenantId: GATEWAY_DEMO_TENANT_ID,
        email: 'a@test.com',
        displayName: 'A',
        roles: [{ roleId: 'principal', roleName: 'Principal', areaId: state.id }],
        areas: [],
        institutions: [],
      },
      'institution',
      'read',
      registry,
      resolver,
      { areaId: district.id },
    );

    expect(denied.granted).toBe(true);
  });

  it('RBAC denies when legacy hardcoded root cannot see UUID areas', async () => {
    const legacy = new InMemoryAreaHierarchyResolver([...LEGACY_HARDCODED_ROOT]);
    const [, , district] = demoGatewayAreaHierarchy();
    const registry = {
      roleHasPermission: () => true,
    };

    const denied = await evaluatePermission(
      {
        userId: 'u1',
        tenantId: GATEWAY_DEMO_TENANT_ID,
        email: 'a@test.com',
        displayName: 'A',
        roles: [{ roleId: 'principal', roleName: 'Principal', areaId: 'root' }],
        areas: [],
        institutions: [],
      },
      'institution',
      'read',
      registry,
      legacy,
      { areaId: district.id },
    );

    expect(denied.granted).toBe(false);
  });
});

describe('W1-ARCH-04 (D6) static contract', () => {
  it('gateway wires createAreaHierarchyResolver instead of hardcoded root', () => {
    expect(existsSync(gatewayAppPath)).toBe(true);
    const src = readFileSync(gatewayAppPath, 'utf8');
    expect(src).toMatch(/createAreaHierarchyResolver/);
    expect(src).not.toMatch(
      /new InMemoryAreaHierarchyResolver\(\[\s*\{\s*id:\s*'root'/,
    );
  });

  it('toAreaNodes builds materialized paths for descendant checks', () => {
    const nodes = toAreaNodes(demoGatewayAreaHierarchy());
    const [, state, district] = nodes;
    expect(district.path.startsWith(`${state.path}/`)).toBe(true);
  });
});
