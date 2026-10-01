import { faker } from './seeded-faker.js';
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
    // PRC-L498: deterministic default; override `status` to exercise other states.
    status: 'ENROLLED',
    startDate,
    endDate: null,
    gradeId: faker.string.uuid(),
    classId: faker.string.uuid(),
    createdAt: startDate,
    updatedAt: faker.date.recent(),
    ...overrides,
  };
}
