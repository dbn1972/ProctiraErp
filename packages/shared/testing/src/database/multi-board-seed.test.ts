/**
 * @vitest-environment node
 *
 * Enterprise certification seed: multiple boards × schools × 500 students.
 */
import { describe, expect, it } from 'vitest';

import {
  assertMultiBoardSeedInvariants,
  DEFAULT_MULTI_BOARD_PROFILE,
  seedMultiBoardSchools,
} from './multi-board-seed.js';

describe('seedMultiBoardSchools — enterprise certification profile', () => {
  it('onboards 3 boards × 2 schools × 500 students with linked enrollments', () => {
    const started = Date.now();
    const result = seedMultiBoardSchools({ studentsPerSchool: 500, staffPerSchool: 25 });
    const elapsedMs = Date.now() - started;

    assertMultiBoardSeedInvariants(result, {
      boards: 3,
      schools: 6,
      studentsPerSchool: 500,
    });

    expect(result.totals).toEqual({
      boardCount: 3,
      schoolCount: 6,
      studentCount: 3000,
      staffCount: 150,
      enrollmentCount: 3000,
    });

    expect(result.boards.map((b) => b.code).sort()).toEqual(
      ['CBSE', 'ICSE', 'MH-STATE'].sort(),
    );

    for (const school of result.schools) {
      expect(school.students).toHaveLength(500);
      expect(school.enrollments).toHaveLength(500);
      expect(school.staff).toHaveLength(25);
      expect(school.institution.boardId).toBe(school.board.id);
      expect(school.academicPeriod.institutionId).toBe(school.institution.id);
    }

    // Volume seed should stay well under a few seconds in-memory on CI hosts.
    expect(elapsedMs).toBeLessThan(30_000);
  });

  it('rejects empty board specs', () => {
    expect(() => seedMultiBoardSchools({ boards: [] })).toThrow(/At least one board/);
  });

  it('supports a slim profile for fast smoke (2 boards × 1 school × 50 students)', () => {
    const slim = DEFAULT_MULTI_BOARD_PROFILE.slice(0, 2).map((b) => ({
      ...b,
      schools: b.schools.slice(0, 1),
    }));
    const result = seedMultiBoardSchools({
      boards: slim,
      studentsPerSchool: 50,
      staffPerSchool: 5,
    });
    assertMultiBoardSeedInvariants(result, {
      boards: 2,
      schools: 2,
      studentsPerSchool: 50,
    });
    expect(result.totals.studentCount).toBe(100);
  });
});
