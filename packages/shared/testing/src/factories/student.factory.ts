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
    nationalId: faker.string.numeric(12),
    email: faker.internet.email(),
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
