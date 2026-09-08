import { inspectPdf, isPdfBuffer } from '@proctira/pdf-lite';
import { describe, expect, it } from 'vitest';
import { SimplePdfGenerator, type ExaminationInfo } from './pdf-generator.js';

const exam: ExaminationInfo = {
  id: 'exam-1',
  name: 'Annual Examination 2026',
  code: 'ANN-26',
  startDate: '2026-03-01',
  endDate: '2026-03-10',
  sessions: [
    { subjectName: 'Mathematics', date: '2026-03-01', startTime: '09:00', endTime: '12:00' },
    { subjectName: 'Physics', date: '2026-03-03', startTime: '09:00', endTime: '12:00' },
  ],
};

describe('SimplePdfGenerator emits real PDFs (G-716)', () => {
  const gen = new SimplePdfGenerator();

  it('admit cards: one page per candidate, real PDF header', async () => {
    const bytes = await gen.generateAdmitCards(exam, [
      {
        id: 'c1', studentId: 's1', studentName: 'Ada Lovelace', rollNumber: 'R-001',
        centerId: 'ce1', centerName: 'Main Hall', subjectIds: ['m'], subjectNames: ['Mathematics'], gender: 'F',
      },
      {
        id: 'c2', studentId: 's2', studentName: 'Alan Turing', rollNumber: 'R-002',
        centerId: 'ce1', centerName: 'Main Hall', subjectIds: ['p'], subjectNames: ['Physics'], gender: 'M',
      },
    ]);
    expect(isPdfBuffer(bytes)).toBe(true);
    const info = inspectPdf(bytes);
    expect(info.pageCount).toBe(2);
    expect(info.startXrefValid).toBe(true);
    expect(info.literalStrings).toContain('Ada Lovelace');
    expect(info.literalStrings).toContain('R-002');
    expect(info.literalStrings).toContain('09:00-12:00');
  });

  it('seating plan: one page per centre with room tables', async () => {
    const bytes = await gen.generateSeatingPlan(exam, [
      { candidateId: 'c1', studentName: 'Ada', rollNumber: 'R-001', centerId: 'a', centerName: 'Hall A', roomNumber: '101', seatNumber: 'S-02', subjectNames: ['Mathematics'] },
      { candidateId: 'c2', studentName: 'Alan', rollNumber: 'R-002', centerId: 'a', centerName: 'Hall A', roomNumber: '101', seatNumber: 'S-01', subjectNames: ['Physics'] },
      { candidateId: 'c3', studentName: 'Grace', rollNumber: 'R-003', centerId: 'b', centerName: 'Hall B', roomNumber: '201', seatNumber: 'S-01', subjectNames: ['Physics'] },
    ]);
    const info = inspectPdf(bytes);
    expect(info.pageCount).toBe(2);
    expect(info.literalStrings).toContain('Hall A');
    expect(info.literalStrings).toContain('Hall B');
    expect(info.literalStrings).toContain('Room 101');
    expect(info.literalStrings).toContain('Total Candidates: 2');
  });

  it('result certificates: scores, grades and pass/fail', async () => {
    const bytes = await gen.generateResultCertificates(exam, [
      {
        candidateId: 'c1', studentId: 's1', studentName: 'Ada Lovelace', rollNumber: 'R-001',
        subjects: [{ name: 'Mathematics', score: 95, grade: 'A', passed: true }],
        overallGrade: 'A', overallPassed: true, totalScore: 95, maxPossibleScore: 100,
      },
    ]);
    const info = inspectPdf(bytes);
    expect(info.pageCount).toBe(1);
    expect(info.literalStrings).toContain('RESULT CERTIFICATE');
    expect(info.literalStrings).toContain('95 / 100');
    expect(info.literalStrings).toContain('PASSED');
  });
});
