import { faker } from '@faker-js/faker';

import type { Institution } from './types.js';

/**
 * Creates an Institution entity with realistic fake data.
 */
export function createInstitution(overrides: Partial<Institution> = {}): Institution {
  return {
    id: faker.string.uuid(),
    tenantId: faker.string.uuid(),
    name: `${faker.company.name()} School`,
    code: faker.string.alphanumeric(8).toUpperCase(),
    boardId: null,
    areaId: faker.string.uuid(),
    typeId: faker.string.uuid(),
    sectorId: faker.string.uuid(),
    ownershipId: faker.string.uuid(),
    status: 'ACTIVE',
    latitude: faker.location.latitude(),
    longitude: faker.location.longitude(),
    address: faker.location.streetAddress({ useFullAddress: true }),
    contactPhone: faker.phone.number(),
    contactEmail: faker.internet.email(),
    customData: {},
    createdAt: faker.date.past(),
    updatedAt: faker.date.recent(),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Creates a list of Institution entities.
 */
export function createInstitutionList(
  count: number = 5,
  overrides: Partial<Institution> = {},
): Institution[] {
  return Array.from({ length: count }, () => createInstitution(overrides));
}
