import type { InfrastructureHierarchy } from './types';

export type FacilityConditionKind = 'good' | 'fair' | 'repair' | 'unknown';

/*
 * PRC-M098: exact token match (case/underscore insensitive) instead of
 * substring checks, so e.g. 'UNAVAILABLE' no longer reads as 'good' via
 * 'AVAILABLE'. Editor values are Good / Fair / Needs repair / Unknown; the
 * legacy upper-snake values seen in older rows are accepted too.
 */
const CONDITION_TOKENS: Record<string, FacilityConditionKind> = {
  good: 'good',
  new: 'good',
  excellent: 'good',
  fair: 'fair',
  average: 'fair',
  'needs repair': 'repair',
  repair: 'repair',
  'under repair': 'repair',
  poor: 'repair',
  damaged: 'repair',
  bad: 'repair',
  unavailable: 'repair',
  unknown: 'unknown',
};

export function normCondition(condition: string | null | undefined): FacilityConditionKind {
  const token = String(condition ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
  return CONDITION_TOKENS[token] ?? 'unknown';
}

/** Every node in the hierarchy, in display order (land → building → floor → room). */
export function allFacilities(
  hierarchy: InfrastructureHierarchy,
): Array<{ id: string; name: string; condition: string }> {
  const items: Array<{ id: string; name: string; condition: string }> = [];
  for (const land of hierarchy.lands) {
    items.push({ id: land.id, name: land.name, condition: land.condition });
    for (const building of land.buildings) {
      items.push({ id: building.id, name: building.name, condition: building.condition });
      for (const floor of building.floors) {
        items.push({ id: floor.id, name: floor.name, condition: floor.condition });
        for (const room of floor.rooms) {
          items.push({ id: room.id, name: room.name, condition: room.condition });
        }
      }
    }
  }
  return items;
}

export function repairTargets(hierarchy: InfrastructureHierarchy): Array<{ id: string; name: string }> {
  return allFacilities(hierarchy)
    .filter((item) => normCondition(item.condition) === 'repair')
    .map(({ id, name }) => ({ id, name }));
}

/**
 * Repair-request targets: flagged facilities first, then every other facility,
 * so a request can be logged before anything is marked 'Needs repair'.
 */
export function repairRequestTargets(
  hierarchy: InfrastructureHierarchy,
): Array<{ id: string; name: string }> {
  const all = allFacilities(hierarchy);
  const flagged = all.filter((item) => normCondition(item.condition) === 'repair');
  const rest = all.filter((item) => normCondition(item.condition) !== 'repair');
  return [...flagged, ...rest].map(({ id, name }) => ({ id, name }));
}
