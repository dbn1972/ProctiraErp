import { faker } from '@faker-js/faker';

import type { AcademicPeriod } from './types.js';

/**
 * Creates an AcademicPeriod entity with realistic fake data.
 */
export function createAcademicPeriod(overrides: Partial<AcademicPeriod> = {}): AcademicPeriod {
  const year = faker.date.recent().getFullYear();
  const startDate = overrides.startDate ?? new Date(`${year}-01-01`);
  const endDate = overrides.endDate ?? new Date(`${year}-12-31`);

  return {
    id: faker.string.uuid(),
    tenantId: faker.string.uuid(),
    institutionId: faker.string.uuid(),
    name: `Academic Year ${year}`,
    code: `AY-${year}`,
    startDate,
    endDate,
    status: faker.helpers.arrayElement(['ACTIVE', 'INACTIVE', 'ARCHIVED']),
    createdAt: faker.date.past(),
    updatedAt: faker.date.recent(),
    ...overrides,
  };
}
