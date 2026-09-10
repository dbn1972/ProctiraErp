/**
 * Multi-tenant fixture utilities for testing tenant isolation.
 */

import { createTenantFixture } from './tenant-fixture.js';
import type { TenantFixture, TenantFixtureOptions } from './tenant-fixture.js';

export interface MultiTenantFixture {
  /** Array of tenant fixtures, each fully isolated */
  tenants: TenantFixture[];
  /** Get a specific tenant by index */
  getTenant(index: number): TenantFixture;
  /** Get all tenant IDs for verification */
  tenantIds: string[];
}

export interface MultiTenantFixtureOptions {
  /** Number of tenants to create (default: 2) */
  tenantCount?: number;
  /** Options applied to each tenant fixture */
  perTenantOptions?: TenantFixtureOptions;
}

/**
 * Creates multiple isolated tenant fixtures for testing multi-tenant isolation.
 * Each tenant has its own area hierarchy, institutions, and users.
 *
 * Useful for verifying:
 * - Data isolation between tenants (RLS policies)
 * - Cross-tenant access prevention
 * - Tenant-scoped queries
 *
 * @example
 * ```ts
 * const fixture = createMultiTenantFixture({ tenantCount: 3 });
 *
 * // Verify tenant A cannot see tenant B's data
 * const tenantA = fixture.getTenant(0);
 * const tenantB = fixture.getTenant(1);
 * expect(tenantA.tenant.id).not.toBe(tenantB.tenant.id);
 * ```
 */
export function createMultiTenantFixture(
  options: MultiTenantFixtureOptions = {},
): MultiTenantFixture {
  const { tenantCount = 2, perTenantOptions = {} } = options;

  const tenants: TenantFixture[] = Array.from({ length: tenantCount }, (_, i) =>
    createTenantFixture({
      ...perTenantOptions,
      tenantName: `Test Tenant ${i + 1}`,
    }),
  );

  return {
    tenants,
    getTenant(index: number): TenantFixture {
      const tenant = tenants[index];
      if (!tenant) {
        throw new Error(
          `Tenant at index ${index} does not exist. Created ${tenants.length} tenants.`,
        );
      }
      return tenant;
    },
    get tenantIds(): string[] {
      return tenants.map((t) => t.tenant.id);
    },
  };
}
