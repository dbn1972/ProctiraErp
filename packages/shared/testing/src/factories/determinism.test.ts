/**
 * PRC-L498: factory determinism and createBoardList defaults.
 */
import { describe, expect, it } from 'vitest';
import { createAcademicPeriod } from './academic-period.factory.js';
import { createAreaHierarchy } from './area.factory.js';
import { createBoardList } from './board.factory.js';
import { createEnrollment } from './enrollment.factory.js';
import { createStudent } from './student.factory.js';
import { resolveFactorySeed, seedFactories } from './seeded-faker.js';

describe('factories determinism (PRC-L498)', () => {
  it('createBoardList keeps generated code/name when no overrides are given', () => {
    const boards = createBoardList(3);
    expect(boards.every((b) => typeof b.code === 'string' && b.code.length > 0)).toBe(true);
    expect(boards.every((b) => typeof b.name === 'string' && b.name.length > 0)).toBe(true);
  });

  it('createBoardList still suffixes explicit code/name overrides', () => {
    const boards = createBoardList(2, { code: 'CB', name: 'Board' });
    expect(boards.map((b) => b.code)).toEqual(['CB1', 'CB2']);
    expect(boards.map((b) => b.name)).toEqual(['Board 1', 'Board 2']);
  });

  it('uses deterministic default statuses', () => {
    for (let i = 0; i < 20; i++) {
      expect(createEnrollment().status).toBe('ENROLLED');
      expect(createAcademicPeriod().status).toBe('ACTIVE');
    }
    expect(createEnrollment({ status: 'WITHDRAWN' }).status).toBe('WITHDRAWN');
  });

  it('marks the effective (capped) last level as the leaf', () => {
    const areas = createAreaHierarchy(undefined, 15);
    expect(areas).toHaveLength(10);
    expect(areas.filter((a) => a.isLeaf).map((a) => a.level)).toEqual([10]);
  });

  it('seedFactories makes output reproducible', () => {
    seedFactories(42);
    const a = createStudent();
    seedFactories(42);
    const b = createStudent();
    expect(b.id).toBe(a.id);
    expect(b.firstName).toBe(a.firstName);
  });

  it('resolveFactorySeed parses FC_SEED integers only', () => {
    expect(resolveFactorySeed({ FC_SEED: '123' })).toBe(123);
    expect(resolveFactorySeed({ FC_SEED: 'abc' })).toBeUndefined();
    expect(resolveFactorySeed({})).toBeUndefined();
  });
});
