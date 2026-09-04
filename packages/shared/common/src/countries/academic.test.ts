import { describe, expect, it } from 'vitest';

import { requireCountry } from './catalog.js';
import {
  academicYearWindow,
  countryBoardDefinitions,
  countryDefaultGrades,
} from './academic.js';

describe('country academic helpers', () => {
  it('expands India boards to CBSE, ICSE, and State', () => {
    const boards = countryBoardDefinitions(requireCountry('IN'));
    expect(boards.map((board) => board.code)).toEqual(['CBSE', 'ICSE', 'STATE']);
    expect(boards[0]).toMatchObject({ type: 'NATIONAL', code: 'CBSE' });
    expect(boards[1]?.type).toBe('PRIVATE');
    expect(boards[2]?.type).toBe('STATE');
  });

  it('seeds Class 1–12 for India', () => {
    const grades = countryDefaultGrades('IN');
    expect(grades).toHaveLength(12);
    expect(grades[0]).toEqual({ name: 'Class 1', code: '1', order: 1 });
    expect(grades[11]).toEqual({ name: 'Class 12', code: '12', order: 12 });
  });

  it('computes the India April–March academic year from a date in term', () => {
    const window = academicYearWindow(4, new Date('2026-09-04T00:00:00Z'));
    expect(window).toMatchObject({
      startYear: 2026,
      endYear: 2027,
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      code: 'AY-2026-27',
      name: 'Academic Year 2026-27',
    });
  });

  it('rolls back to the previous start year before April', () => {
    const window = academicYearWindow(4, new Date('2026-02-01T00:00:00Z'));
    expect(window.code).toBe('AY-2025-26');
    expect(window.startDate).toBe('2025-04-01');
    expect(window.endDate).toBe('2026-03-31');
  });
});
