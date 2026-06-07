import { faker } from '@faker-js/faker';

import type { Tenant, TenantConfig } from './types.js';

/**
 * Creates a TenantConfig with sensible defaults.
 */
export function createTenantConfig(overrides: Partial<TenantConfig> = {}): TenantConfig {
  return {
    locale: 'en',
    timezone: faker.location.timeZone(),
    dateFormat: 'YYYY-MM-DD',
    academicYearStart: faker.number.int({ min: 1, max: 12 }),
    features: {
      attendance: true,
      assessments: true,
      examinations: true,
      scholarships: false,
      transport: false,
    },
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
