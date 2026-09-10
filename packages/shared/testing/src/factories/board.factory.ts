import { faker } from '@faker-js/faker';

import type { Board, BoardType } from './types.js';

/**
 * Creates an education Board entity (data entity under a tenant — not a tenant).
 */
export function createBoard(overrides: Partial<Board> = {}): Board {
  const type: BoardType = overrides.type ?? 'STATE';
  return {
    id: faker.string.uuid(),
    tenantId: faker.string.uuid(),
    name: overrides.name ?? `${faker.location.state()} Education Board`,
    code: overrides.code ?? faker.string.alphanumeric(6).toUpperCase(),
    type,
    status: 'active',
    createdAt: faker.date.past(),
    updatedAt: faker.date.recent(),
    deletedAt: null,
    ...overrides,
  };
}

export function createBoardList(count: number, overrides: Partial<Board> = {}): Board[] {
  return Array.from({ length: count }, (_, i) =>
    createBoard({
      ...overrides,
      code: overrides.code ? `${overrides.code}${i + 1}` : undefined,
      name: overrides.name ? `${overrides.name} ${i + 1}` : undefined,
    }),
  );
}
