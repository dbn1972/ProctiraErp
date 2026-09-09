import { describe, expect, it } from 'vitest';

import { marksCsvTemplate, parseMarksCsv } from './marks-csv';

const subjects = [
  { id: '11111111-1111-4111-8111-111111111111', code: 'MATH' },
  { id: '22222222-2222-4222-8222-222222222222', code: 'SCI' },
];

describe('parseMarksCsv', () => {
  it('maps subject codes to ids and blank cells to null', () => {
    const csv = 'studentId,MATH,SCI\nabc,85,\n';
    const { entries, errors } = parseMarksCsv(csv, subjects);
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      {
        studentId: 'abc',
        marks: [
          { subjectId: subjects[0]!.id, score: 85 },
          { subjectId: subjects[1]!.id, score: null },
        ],
      },
    ]);
  });

  it('reports unknown subject codes and non-numeric scores', () => {
    const { errors } = parseMarksCsv('studentId,MATH,ART\nabc,x,10', subjects);
    expect(errors).toContain("Unknown subject code 'ART'");
    expect(errors.some((e) => e.includes("'x' is not a number"))).toBe(true);
  });

  it('produces a header-only template', () => {
    expect(marksCsvTemplate(subjects)).toBe('studentId,MATH,SCI\n');
  });
});
