import { faker } from '@faker-js/faker';
import { defaultTenantConfig } from '@proctira/common';

import type { Tenant, TenantConfig } from './types.js';

/**
 * Creates a TenantConfig. Defaults are India — the first implemented country.
 */
export function createTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    ...defaultTenantConfig(),
    ...overrides,
  };
}

/**
 * Creates a Tenant entity with realistic fake data.
 */
export function createTenant(overrides: Partial<Tenant> = {}): Tenant {
  const name = overrides.name ?? faker.company.name();
  const slug = overrides.slug ?? faker.helpers.slugify(name).toLowerCase();

  return {
    id: faker.string.uuid(),
    name,
    slug,
    domain: `${slug}.proctira.org`,
    status: 'ACTIVE',
    config: createTenantConfig(),
    createdAt: faker.date.past(),
    updatedAt: faker.date.recent(),
    deletedAt: null,
    ...overrides,
  };
}
