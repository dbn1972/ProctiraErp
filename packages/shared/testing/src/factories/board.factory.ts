import { faker } from './seeded-faker.js';
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
    // PRC-L498: omit code/name (never set them to undefined) so createBoard's
    // generated defaults survive the `...overrides` spread.
    createBoard({
      ...overrides,
      ...(overrides.code ? { code: `${overrides.code}${i + 1}` } : {}),
      ...(overrides.name ? { name: `${overrides.name} ${i + 1}` } : {}),
    }),
  );
}
