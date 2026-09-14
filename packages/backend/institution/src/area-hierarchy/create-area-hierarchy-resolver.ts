/**
 * Factory for the gateway / RBAC area hierarchy resolver (W1-ARCH-04 D6).
 */
import type { AreaHierarchyResolver } from '@proctira/auth';
import { assertInMemoryFallbackAllowed } from '@proctira/database';

import {
  TenantScopedAreaHierarchyResolver,
  type RegisterableArea,
} from './area-hierarchy-resolver.js';

/** Default gateway test / dev tenant — matches api-gateway JWT fixtures. */
export const GATEWAY_DEMO_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

/** Three-level demo hierarchy for in-memory gateway composition. */
export function demoGatewayAreaHierarchy(): RegisterableArea[] {
  const countryId = '770e8400-e29b-41d4-a716-446655440001';
  const stateId = '770e8400-e29b-41d4-a716-446655440002';
  const districtId = '770e8400-e29b-41d4-a716-446655440003';
  return [
    { id: countryId, parentId: null, level: 1 },
    { id: stateId, parentId: countryId, level: 2 },
    { id: districtId, parentId: stateId, level: 3 },
  ];
}

export interface AreaHierarchyResolverConfig {
  databaseUrl?: string;
  /** Extra tenant trees for in-memory mode (merged with demo seed). */
  seedTenants?: Record<string, RegisterableArea[]>;
}

export function isPgAreaHierarchyEnabled(config: AreaHierarchyResolverConfig = {}): boolean {
  return Boolean((config.databaseUrl ?? process.env['DATABASE_URL'])?.trim());
}

/** Compose the tenant-scoped resolver used by RBAC (Postgres lazy-load or seeded in-memory). */
export function createAreaHierarchyResolver(
  config: AreaHierarchyResolverConfig = {},
): AreaHierarchyResolver {
  const resolver = new TenantScopedAreaHierarchyResolver();
  const pgEnabled = isPgAreaHierarchyEnabled(config);

  if (!pgEnabled) {
    assertInMemoryFallbackAllowed('area-hierarchy-resolver');
    resolver.registerTenantAreas(GATEWAY_DEMO_TENANT_ID, demoGatewayAreaHierarchy());
    for (const [tenantId, areas] of Object.entries(config.seedTenants ?? {})) {
      resolver.registerTenantAreas(tenantId, areas);
    }
  }

  return resolver;
}

/** Narrow type guard for tests that need registerTenantAreas. */
export function asTenantScopedResolver(
  resolver: AreaHierarchyResolver,
): TenantScopedAreaHierarchyResolver | undefined {
  return resolver instanceof TenantScopedAreaHierarchyResolver ? resolver : undefined;
}
