import { faker } from '@faker-js/faker';

import type { Enrollment } from './types.js';

/**
 * Creates an Enrollment entity with realistic fake data.
 */
export function createEnrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  const startDate = overrides.startDate ?? faker.date.past();

  return {
    id: faker.string.uuid(),
    tenantId: faker.string.uuid(),
    studentId: faker.string.uuid(),
    institutionId: faker.string.uuid(),
    academicPeriodId: faker.string.uuid(),
    status: faker.helpers.arrayElement(['ENROLLED', 'TRANSFERRED', 'WITHDRAWN', 'GRADUATED']),
    startDate,
    endDate: null,
    gradeId: faker.string.uuid(),
    classId: faker.string.uuid(),
    createdAt: startDate,
    updatedAt: faker.date.recent(),
    ...overrides,
  };
}
