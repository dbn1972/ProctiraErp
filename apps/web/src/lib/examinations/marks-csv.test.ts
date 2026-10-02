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

describe('parseMarksCsv validation (PRC-L229)', () => {
  const bounded = [
    { id: subjects[0]!.id, code: 'MATH', maxScore: 100 },
    { id: subjects[1]!.id, code: 'SCI', maxScore: 50 },
  ];

  it.each(['-1', '101', '1e999', 'Infinity', '1e2', '85.123', '0x10'])(
    "rejects score '%s' and returns no entries",
    (raw) => {
      const { entries, errors } = parseMarksCsv(`studentId,MATH\nabc,${raw}\n`, bounded);
      expect(errors.length).toBeGreaterThan(0);
      expect(entries).toEqual([]);
    },
  );

  it('enforces each subject maximum', () => {
    const { errors } = parseMarksCsv('studentId,MATH,SCI\nabc,100,51\n', bounded);
    expect(errors).toEqual(['Row 2: 51 is outside 0–50 for SCI']);
  });

  it('accepts boundary and two-decimal scores', () => {
    const { entries, errors } = parseMarksCsv('studentId,MATH,SCI\nabc,0,49.5\n', bounded);
    expect(errors).toEqual([]);
    expect(entries[0]!.marks.map((m) => m.score)).toEqual([0, 49.5]);
  });

  it('rejects duplicate and blank student ids', () => {
    const { entries, errors } = parseMarksCsv('studentId,MATH\nabc,1\nabc,2\n,3\n', bounded);
    expect(errors).toEqual(['Row 3: duplicate studentId abc', 'Row 4: studentId is required']);
    expect(entries).toEqual([]);
  });

  it('rejects duplicate subject headers', () => {
    const { errors } = parseMarksCsv('studentId,MATH,math\nabc,1,2\n', bounded);
    expect(errors).toContain("Duplicate subject column 'math'");
  });

  it('parses quoted fields containing commas', () => {
    const { entries, errors } = parseMarksCsv('"studentId","MATH"\n"abc","7"\n', bounded);
    expect(errors).toEqual([]);
    expect(entries).toEqual([
      { studentId: 'abc', marks: [{ subjectId: bounded[0]!.id, score: 7 }] },
    ]);
    const quotedComma = parseMarksCsv('studentId,MATH\n"a,b",7\n', bounded);
    expect(quotedComma.entries[0]!.studentId).toBe('a,b');
  });

  it('rejects rows with extra cells', () => {
    const { errors } = parseMarksCsv('studentId,MATH\nabc,1,2\n', bounded);
    expect(errors).toEqual(['Row 2: expected 2 columns, found 3']);
  });
});
