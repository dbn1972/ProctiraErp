import { faker } from './seeded-faker.js';
import type { Area } from './types.js';

/**
 * Creates an Area entity with realistic fake data.
 */
export function createArea(overrides: Partial<Area> = {}): Area {
  return {
    id: faker.string.uuid(),
    tenantId: faker.string.uuid(),
    name: faker.location.state(),
    code: faker.string.alphanumeric(6).toUpperCase(),
    level: overrides.level ?? 1,
    parentId: overrides.parentId ?? null,
    isLeaf: overrides.isLeaf ?? false,
    createdAt: faker.date.past(),
    updatedAt: faker.date.recent(),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * Creates a hierarchical area structure (country → region → district → zone).
 * Returns a flat array of areas with proper parent-child relationships.
 */
export function createAreaHierarchy(
  tenantId: string = faker.string.uuid(),
  depth: number = 4,
): Area[] {
  const areas: Area[] = [];
  const levelNames = ['Country', 'Region', 'District', 'Zone', 'Sub-Zone'];

  let parentId: string | null = null;

  // PRC-L498: the loop is capped at 10 levels, so the leaf is the effective depth.
  const effectiveDepth = Math.min(depth, 10);
  for (let level = 1; level <= effectiveDepth; level++) {
    const area = createArea({
      tenantId,
      level,
      parentId,
      name: `${levelNames[level - 1] ?? `Level ${level}`} - ${faker.location.city()}`,
      isLeaf: level === effectiveDepth,
    });
    areas.push(area);
    parentId = area.id;
  }

  return areas;
}
