import { describe, expect, it, vi } from 'vitest';

import { seedAcademicStructure, type AcademicStructureStore } from './academic-structure.js';

function createStore(): AcademicStructureStore {
  return {
    board: {
      upsert: vi.fn(async ({ create }) => ({
        id: `board-${create.code}`,
        code: create.code,
        name: create.name,
        type: create.type,
      })),
    },
    academicPeriod: {
      upsert: vi.fn(async ({ create }) => ({
        id: 'period-1',
        code: create.code,
        name: create.name,
      })),
    },
    grade: {
      upsert: vi.fn(async ({ create }) => ({
        id: `grade-${create.code}`,
        code: create.code,
        name: create.name,
        order: create.order,
      })),
    },
  };
}

describe('seedAcademicStructure', () => {
  it('seeds India boards, AY 2026-27, and Class 1–12', async () => {
    const db = createStore();
    const result = await seedAcademicStructure(db, {
      tenantId: 'tenant-india',
      countryCode: 'IN',
      now: new Date('2026-09-04T00:00:00Z'),
    });

    expect(result.boards.map((board) => board.code)).toEqual(['CBSE', 'ICSE', 'STATE']);
    expect(result.academicPeriod.code).toBe('AY-2026-27');
    expect(result.grades).toHaveLength(12);
    expect(result.grades[0]).toMatchObject({ code: '1', name: 'Class 1' });
    expect(db.board.upsert).toHaveBeenCalledTimes(3);
    expect(db.grade.upsert).toHaveBeenCalledTimes(12);
  });
});
