import { describe, expect, it } from 'vitest';

import { buildMarksheetCsv, buildPdfLiteHtml } from './board-export-generator.js';
import type { BoardExportContext } from './board-export-generator.js';
import { getBoardPack } from './board-pack-registry.js';
import type { BoardExportCandidate } from './gradebook-repository.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const BOARD = '22222222-2222-4222-8222-222222222222';
const INST = '66666666-6666-4666-8666-666666666666';
const STUDENT = '33333333-3333-4333-8333-333333333333';

function ctxWith(candidate: BoardExportCandidate): BoardExportContext {
  const pack = getBoardPack('CBSE')!;
  return {
    jobId: 'job-1',
    tenantId: TENANT,
    boardId: BOARD,
    institutionId: INST,
    institutionCode: 'CBSE-DEL-01',
    institutionName: 'CBSE Demo',
    affiliationCode: 'CBSE-AFF-DEMO',
    centreCode: 'CBSE-CTR-DEMO',
    pack,
    candidates: [candidate],
  };
}

// PRC-M516 / NEW-g5_academic-005: the board marksheet carries minors' national
// IDs + marks and is opened by board officers in Excel. A cell starting with a
// formula lead char must be neutralised, and HTML interpolations must be escaped.
describe('board export injection hardening', () => {
  it('neutralises spreadsheet formula injection in the marksheet CSV', () => {
    const csv = buildMarksheetCsv(
      ctxWith({
        studentId: STUDENT,
        firstName: '=HYPERLINK("http://evil","x")',
        lastName: 'Student',
        nationalId: '=1+2',
        institutionId: INST,
        grades: [
          { assessmentCode: 'ENG', numericScore: 88, letterGrade: null },
          { assessmentCode: 'MATH', numericScore: 95, letterGrade: null },
          { assessmentCode: 'SCI', numericScore: 84, letterGrade: null },
          { assessmentCode: 'SST', numericScore: 79, letterGrade: null },
        ],
        latestTranscript: null,
      }),
    );
    // No raw cell should begin with a formula trigger. Quoted cells are wrapped
    // in double quotes, so the leading char after a comma is either a quote or
    // the neutralising apostrophe — never = + - @.
    for (const line of csv.split('\n').slice(1).filter(Boolean)) {
      for (const cell of line.split(',')) {
        const inner = cell.startsWith('"') ? cell.slice(1) : cell;
        expect(/^[=+\-@]/.test(inner)).toBe(false);
      }
    }
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'=1+2");
  });

  it('HTML-escapes names and national IDs in the PDF-lite marksheet', () => {
    const html = buildPdfLiteHtml(
      ctxWith({
        studentId: STUDENT,
        firstName: '<img src=x onerror=alert(1)>',
        lastName: 'Student',
        nationalId: '<script>bad()</script>',
        institutionId: INST,
        grades: [
          { assessmentCode: 'ENG', numericScore: 88, letterGrade: null },
          { assessmentCode: 'MATH', numericScore: 95, letterGrade: null },
          { assessmentCode: 'SCI', numericScore: 84, letterGrade: null },
          { assessmentCode: 'SST', numericScore: 79, letterGrade: null },
        ],
        latestTranscript: null,
      }),
    );
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>bad()</script>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;bad()&lt;/script&gt;');
  });
});
