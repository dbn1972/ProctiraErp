import { faker } from '@faker-js/faker';

import type { Student } from './types.js';

/**
 * Creates a Student entity with realistic fake data.
 */
export function createStudent(overrides: Partial<Student> = {}): Student {
  const gender = faker.helpers.arrayElement(['male', 'female'] as const);
  const sex = gender === 'male' ? 'male' : 'female';

  return {
    id: faker.string.uuid(),
    tenantId: faker.string.uuid(),
    firstName: faker.person.firstName(sex),
    lastName: faker.person.lastName(sex),
    dateOfBirth: faker.date.birthdate({ min: 5, max: 20, mode: 'age' }),
    gender: gender.toUpperCase(),
    // PRC-L587: never generate realistic-looking national IDs / emails for
    // minors. Use a reserved, obviously-fake marker prefix for the id and the
    // RFC 2606 reserved `.test` domain so this data can never be mistaken for or
    // used as a real identity outside tests.
    nationalId: `TEST-${faker.string.numeric(8)}`,
    email: faker.internet.email({ provider: 'example.test' }),
    phone: faker.phone.number(),
    address: faker.location.streetAddress(),
    nationality: faker.location.country(),
    photoUrl: null,
    customData: {},
    createdAt: faker.date.past(),
    updatedAt: faker.date.recent(),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Creates a list of Student entities.
 */
export function createStudentList(count: number = 10, overrides: Partial<Student> = {}): Student[] {
  return Array.from({ length: count }, () => createStudent(overrides));
}
