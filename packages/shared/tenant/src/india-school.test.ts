import { describe, expect, it, vi } from 'vitest';

import {
  INDIA_DEMO_SCHOOL_CODE,
  seedIndiaDemoSchool,
  type IndiaSchoolStore,
} from './india-school.js';

function createStore(): IndiaSchoolStore {
  const grades = [
    { id: 'g1', code: '1', name: 'Class 1', order: 1 },
    { id: 'g2', code: '2', name: 'Class 2', order: 2 },
  ];
  return {
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-india' }) },
    geographicArea: { findFirst: vi.fn().mockResolvedValue({ id: 'area-in' }) },
    board: { findFirst: vi.fn().mockResolvedValue({ id: 'board-cbse', code: 'CBSE' }) },
    academicPeriod: { findFirst: vi.fn().mockResolvedValue({ id: 'period-1', code: 'AY-2026-27' }) },
    grade: { findMany: vi.fn().mockResolvedValue(grades) },
    institution: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'school-1',
        name: 'Kendriya Vidyalaya Proctira',
        code: INDIA_DEMO_SCHOOL_CODE,
        boardId: 'board-cbse',
      }),
    },
    class: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }) => ({
        id: `class-${data.gradeId}`,
        name: data.name,
        gradeId: data.gradeId,
      })),
    },
  };
}

describe('seedIndiaDemoSchool', () => {
  it('creates the CBSE demo school and one section per grade', async () => {
    const db = createStore();
    const result = await seedIndiaDemoSchool(db);

    expect(result.institution.code).toBe(INDIA_DEMO_SCHOOL_CODE);
    expect(result.institution.boardId).toBe('board-cbse');
    expect(result.classes.map((item) => item.name)).toEqual(['Class 1 A', 'Class 2 A']);
    expect(db.institution.create).toHaveBeenCalled();
    expect(db.class.create).toHaveBeenCalledTimes(2);
  });

  it('fails when academic structure was not seeded', async () => {
    const db = createStore();
    db.board.findFirst = vi.fn().mockResolvedValue(null);
    await expect(seedIndiaDemoSchool(db)).rejects.toThrow(/CBSE board is missing/);
  });
});
