/**
 * PRC-H064: board export must (a) use the board's own pass mark, (b) never
 * fabricate a per-subject grade from the candidate's overall average, and
 * (c) only include LOCKED/PUBLISHED grades.
 */
import { describe, expect, it } from 'vitest';

import { getBoardPack } from './board-pack-registry.js';
import { buildMarksheetCsv } from './board-export-generator.js';
import type { BoardExportContext } from './board-export-generator.js';
import type { BoardExportCandidate } from './gradebook-repository.js';
import { InMemoryGradebookRepository } from './in-memory-repository.js';

const INST = '66666666-6666-4666-8666-666666666666';

function ctx(
  pack: ReturnType<typeof getBoardPack>,
  candidates: BoardExportCandidate[],
): BoardExportContext {
  return {
    jobId: 'job-1',
    tenantId: 't1',
    boardId: 'b1',
    institutionId: INST,
    institutionCode: 'C1',
    institutionName: 'School',
    affiliationCode: 'AFF',
    centreCode: 'CTR',
    pack: pack!,
    candidates,
  };
}

function candidate(grades: BoardExportCandidate['grades']): BoardExportCandidate {
  return {
    studentId: 's1',
    firstName: 'A',
    lastName: 'B',
    nationalId: 'N1',
    institutionId: INST,
    grades,
    latestTranscript: null,
  };
}

describe('board export result uses per-board pass mark (PRC-H064)', () => {
  it('MH-STATE: 34 marks is a FAIL (pass mark 35), not a hard-coded 33 pass', () => {
    const pack = getBoardPack('MH-STATE');
    const grades = pack!.requiredSubjects.map((s) => ({
      assessmentCode: s,
      numericScore: s === 'MATH' ? 34 : 80,
      letterGrade: null,
    }));
    const csv = buildMarksheetCsv(ctx(pack, [candidate(grades)]));
    const dataLine = csv.trim().split('\n')[1]!;
    expect(dataLine).toContain('FAIL');
  });

  it('CBSE: 34 marks passes (pass mark 33)', () => {
    const pack = getBoardPack('CBSE');
    const grades = pack!.requiredSubjects.map((s) => ({
      assessmentCode: s,
      numericScore: s === 'MATH' ? 34 : 80,
      letterGrade: null,
    }));
    const csv = buildMarksheetCsv(ctx(pack, [candidate(grades)]));
    const dataLine = csv.trim().split('\n')[1]!;
    expect(dataLine).toContain('PASS');
  });
});

describe('board export never fabricates a subject grade from the average (PRC-H064)', () => {
  it('a subject with marks but no letter grade uses its OWN band, not the overall average', () => {
    const pack = getBoardPack('CBSE');
    // ENG very low, others high. The ENG grade cell must reflect ENG's own band
    // (E), not a band derived from the overall average.
    const grades = pack!.requiredSubjects.map((s) => ({
      assessmentCode: s,
      numericScore: s === 'ENG' ? 10 : 95,
      letterGrade: null,
    }));
    const header = buildMarksheetCsv(ctx(pack, [candidate(grades)]))
      .split('\n')[0]!
      .split(',');
    const engGradeIdx = header.indexOf('ENG_grade');
    const dataCells = buildMarksheetCsv(ctx(pack, [candidate(grades)]))
      .trim()
      .split('\n')[1]!
      .split(',');
    // ENG scored 10 → band 'E'. A fabricated-from-average band would be 'A1'.
    expect(dataCells[engGradeIdx]).toBe('E');
  });
});

describe('board export only includes LOCKED/PUBLISHED grades (PRC-H064)', () => {
  it('omits DRAFT grades when synthesising candidates from entries', async () => {
    const repo = new InMemoryGradebookRepository();
    const base = {
      sectionId: null,
      assessmentCode: 'MATH',
      letterGrade: null,
      enteredBy: 'teacher-1',
      enteredAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await repo.createGradeEntry({
      ...base,
      id: 'g-draft',
      tenantId: 't1',
      studentId: 's-draft',
      numericScore: 90,
      metadata: { workflowStatus: 'DRAFT' },
      lockedAt: null,
      publishedAt: null,
    });
    await repo.createGradeEntry({
      ...base,
      id: 'g-pub',
      tenantId: 't1',
      studentId: 's-pub',
      numericScore: 70,
      metadata: { workflowStatus: 'PUBLISHED' },
      lockedAt: null,
      publishedAt: '2026-01-01T00:00:00.000Z',
    });

    const rows = await repo.listBoardExportCandidates('t1', { institutionId: INST });
    const studentIds = rows.map((r) => r.studentId);
    expect(studentIds).toContain('s-pub');
    expect(studentIds).not.toContain('s-draft');
  });
});
