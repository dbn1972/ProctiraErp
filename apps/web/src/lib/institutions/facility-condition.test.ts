import { describe, expect, it } from 'vitest';
import { normCondition, repairRequestTargets, repairTargets } from './facility-condition';
import type { InfrastructureHierarchy } from './types';

const hierarchy = {
  lands: [
    {
      id: 'l1',
      name: 'Main campus',
      condition: 'Good',
      buildings: [
        {
          id: 'b1',
          name: 'Block A',
          condition: 'Fair',
          floors: [
            {
              id: 'f1',
              name: 'Ground',
              condition: 'Good',
              rooms: [{ id: 'r1', name: 'G-01', condition: 'NEEDS_REPAIR' }],
            },
          ],
        },
      ],
    },
  ],
} as unknown as InfrastructureHierarchy;

describe('facility condition helpers (PRC-M098)', () => {
  it('matches exact condition tokens, not substrings', () => {
    expect(normCondition('UNAVAILABLE')).toBe('repair');
    expect(normCondition('AVAILABLE')).toBe('unknown');
    expect(normCondition('Good')).toBe('good');
    expect(normCondition('GOOD')).toBe('good');
    expect(normCondition('Fair')).toBe('fair');
    expect(normCondition('Needs repair')).toBe('repair');
    expect(normCondition('NEEDS_REPAIR')).toBe('repair');
    expect(normCondition('Unknown')).toBe('unknown');
    expect(normCondition('Not good')).toBe('unknown');
    expect(normCondition('')).toBe('unknown');
  });

  it('offers every facility as a repair-request target, flagged first', () => {
    expect(repairTargets(hierarchy).map((t) => t.id)).toEqual(['r1']);
    expect(repairRequestTargets(hierarchy).map((t) => t.id)).toEqual(['r1', 'l1', 'b1', 'f1']);
  });

  it('still offers targets when nothing is flagged', () => {
    const clean = JSON.parse(JSON.stringify(hierarchy)) as InfrastructureHierarchy;
    clean.lands[0]!.buildings[0]!.floors[0]!.rooms[0]!.condition = 'Good';
    expect(repairTargets(clean)).toEqual([]);
    expect(repairRequestTargets(clean)).toHaveLength(4);
  });
});
