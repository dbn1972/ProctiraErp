import { faker } from '@faker-js/faker';

import type { Staff } from './types.js';

/**
 * Creates a Staff entity with realistic fake data.
 */
export function createStaff(overrides: Partial<Staff> = {}): Staff {
  const gender = faker.helpers.arrayElement(['male', 'female'] as const);
  const sex = gender === 'male' ? 'male' : 'female';

  return {
    id: faker.string.uuid(),
    tenantId: faker.string.uuid(),
    firstName: faker.person.firstName(sex),
    lastName: faker.person.lastName(sex),
    dateOfBirth: faker.date.birthdate({ min: 22, max: 65, mode: 'age' }),
    gender: gender.toUpperCase(),
    identityNumber: faker.string.numeric(10),
    email: faker.internet.email(),
    phone: faker.phone.number(),
    position: faker.helpers.arrayElement([
      'Teacher',
      'Principal',
      'Vice Principal',
      'Counselor',
      'Librarian',
      'Administrator',
    ]),
    address: faker.location.streetAddress(),
    customData: {},
    createdAt: faker.date.past(),
    updatedAt: faker.date.recent(),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Creates a list of Staff entities.
 */
export function createStaffList(count: number = 5, overrides: Partial<Staff> = {}): Staff[] {
  return Array.from({ length: count }, () => createStaff(overrides));
}
