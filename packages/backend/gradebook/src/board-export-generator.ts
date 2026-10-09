/**
 * Board marksheet / exam export generators — CSV + structured JSON (PDF-lite).
 * Writes under /opt/cursor/artifacts/sis-board-exports/ (or ARTIFACT_ROOT override).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BoardPackDefinition } from './board-pack-registry.js';
import type { BoardExportCandidate } from './gradebook-repository.js';

export type BoardExportContext = {
  jobId: string;
  tenantId: string;
  boardId: string;
  institutionId: string;
  institutionCode: string;
  institutionName: string;
  affiliationCode: string;
  centreCode: string;
  pack: BoardPackDefinition;
  candidates: BoardExportCandidate[];
  artifactRoot?: string;
};

export type BoardExportArtifacts = {
  artifactDir: string;
  packJsonPath: string;
  marksheetCsvPath: string;
  examResultsJsonPath: string;
  pdfLitePath: string;
  checksumSha256: string;
  candidateCount: number;
  marksheetCsv: string;
  packJson: string;
};

function defaultArtifactRoot(): string {
  return process.env.SIS_BOARD_EXPORT_DIR?.trim() || '/opt/cursor/artifacts/sis-board-exports';
}

// PRC-M516 / NEW-g5_academic-005: neutralise spreadsheet formula injection.
// A board marksheet carries minors' national IDs + marks and is opened by board
// officers in Excel/Sheets. A cell beginning with = + - @ (or a leading tab/CR)
// is treated as a formula, so a registrar/import-sourced value like
// =HYPERLINK("http://evil","x") would execute. Prefix such cells with a single
// quote so the spreadsheet treats them as text, then apply RFC-4180 quoting.
function neutraliseFormula(value: string): string {
  if (value.length > 0 && /^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function csvEscape(value: string): string {
  const neutralised = neutraliseFormula(value);
  if (/[",\n\r]/.test(neutralised)) {
    return `"${neutralised.replace(/"/g, '""')}"`;
  }
  return neutralised;
}

// PRC-M516 / NEW-g5_academic-005: HTML-escape every value interpolated into the
// PDF-lite marksheet HTML so a student name / national ID containing markup
// (e.g. <img onerror=...>) cannot execute when the artifact is opened.
function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function studentName(c: BoardExportCandidate): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

function subjectMap(
  c: BoardExportCandidate,
): Record<string, { marks: number | null; grade: string | null }> {
  const out: Record<string, { marks: number | null; grade: string | null }> = {};
  for (const g of c.grades) {
    const code = (g.assessmentCode ?? 'UNK').toUpperCase();
    out[code] = { marks: g.numericScore, grade: g.letterGrade };
  }
  return out;
}

function deriveResult(pack: BoardPackDefinition, c: BoardExportCandidate): string {
  const map = subjectMap(c);
  for (const subj of pack.requiredSubjects) {
    const row = map[subj];
    if (!row) return 'INCOMPLETE';
    // PRC-H064: use the board's own pass mark, not a hard-coded 33, so a 34 in
    // a 35-pass board (MH-STATE) is correctly FAIL.
    if (row.marks != null && row.marks < pack.passMark) {
      return pack.code === 'ICSE' ? 'Fail' : 'FAIL';
    }
  }
  return pack.code === 'ICSE' ? 'Pass' : 'PASS';
}

/**
 * PRC-H064: the per-subject grade cell. Use the stored letter grade when
 * present; otherwise derive a band from THAT subject's own marks (never the
 * candidate's overall average); blank when there is no mark for the subject.
 * This stops a letter-only / unmarked subject from being filled with a grade
 * invented from other subjects.
 */
function subjectGradeCell(
  pack: BoardPackDefinition,
  cell: { marks: number | null; grade: string | null } | undefined,
): string {
  if (!cell) return '';
  if (cell.grade != null && cell.grade.length > 0) return cell.grade;
  if (cell.marks != null) return bandForMarks(pack, cell.marks);
  return '';
}

/** Band label for a single marks value under the board's scheme. */
function bandForMarks(pack: BoardPackDefinition, value: number): string {
  if (pack.code === 'MH-STATE') {
    if (value >= 75) return 'Distinction';
    if (value >= 60) return 'First';
    if (value >= 45) return 'Second';
    if (value >= 35) return 'Pass';
    return 'Fail';
  }
  if (pack.code === 'ICSE') {
    if (value >= 90) return '1';
    if (value >= 80) return '2';
    if (value >= 70) return '3';
    if (value >= 60) return '4';
    if (value >= 50) return '5';
    if (value >= 40) return '6';
    if (value >= 35) return '7';
    return 'Fail';
  }
  // CBSE 9-pt approx
  if (value >= 91) return 'A1';
  if (value >= 81) return 'A2';
  if (value >= 71) return 'B1';
  if (value >= 61) return 'B2';
  if (value >= 51) return 'C1';
  if (value >= 41) return 'C2';
  if (value >= 33) return 'D';
  return 'E';
}

export function buildMarksheetCsv(ctx: BoardExportContext): string {
  const { pack, candidates } = ctx;
  const subjectHeaders = pack.requiredSubjects.flatMap((s) => [`${s}_marks`, `${s}_grade`]);
  const headers = [
    pack.marksheetFields.find((f) => f.source === 'nationalId')!.exportKey,
    pack.marksheetFields.find((f) => f.source === 'studentName')!.exportKey,
    pack.marksheetFields.find((f) => f.source === 'affiliationCode')!.exportKey,
    pack.marksheetFields.find((f) => f.source === 'centreCode')!.exportKey,
    ...subjectHeaders,
    pack.marksheetFields.find((f) => f.source === 'result')!.exportKey,
    'security_mark',
  ];

  const lines = [headers.join(',')];
  for (const c of candidates) {
    const map = subjectMap(c);
    const cells = [
      csvEscape(c.nationalId ?? c.studentId),
      csvEscape(studentName(c)),
      csvEscape(ctx.affiliationCode),
      csvEscape(ctx.centreCode),
      ...pack.requiredSubjects.flatMap((s) => [
        map[s]?.marks != null ? String(map[s].marks) : '',
        csvEscape(subjectGradeCell(pack, map[s])),
      ]),
      csvEscape(deriveResult(pack, c)),
      csvEscape(pack.securityMark),
    ];
    lines.push(cells.join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function buildExamResultsJson(ctx: BoardExportContext): unknown {
  const rows: Record<string, unknown>[] = [];
  for (const c of ctx.candidates) {
    const map = subjectMap(c);
    for (const subj of [...ctx.pack.requiredSubjects, ...ctx.pack.optionalSubjects]) {
      const g = map[subj];
      if (!g) continue;
      rows.push({
        [ctx.pack.examResultFields.find((f) => f.source === 'nationalId')!.exportKey]:
          c.nationalId ?? c.studentId,
        [ctx.pack.examResultFields.find((f) => f.source === 'centreCode')!.exportKey]:
          ctx.centreCode,
        [ctx.pack.examResultFields.find((f) => f.source === 'subjectCode')!.exportKey]: subj,
        [ctx.pack.examResultFields.find((f) => f.source === 'marksObtained')!.exportKey]: g.marks,
        [ctx.pack.examResultFields.find((f) => f.source === 'grade')!.exportKey]: subjectGradeCell(
          ctx.pack,
          g,
        ),
        transcriptVersion: c.latestTranscript?.version ?? null,
        transcriptChecksum: c.latestTranscript?.checksumSha256 ?? null,
      });
    }
  }
  return {
    board: ctx.pack.code,
    packVersion: ctx.pack.version,
    securityMark: ctx.pack.securityMark,
    institution: {
      id: ctx.institutionId,
      code: ctx.institutionCode,
      name: ctx.institutionName,
      affiliation: ctx.affiliationCode,
      centre: ctx.centreCode,
    },
    candidateCount: ctx.candidates.length,
    results: rows,
  };
}

export function buildPdfLiteHtml(ctx: BoardExportContext): string {
  const rows = ctx.candidates
    .map((c) => {
      const map = subjectMap(c);
      const marks = ctx.pack.requiredSubjects
        .map((s) => `${s}:${map[s]?.marks ?? '—'}`)
        .join(' · ');
      return `<tr><td>${escapeHtml(c.nationalId ?? c.studentId)}</td><td>${escapeHtml(studentName(c))}</td><td>${escapeHtml(marks)}</td><td>${escapeHtml(deriveResult(ctx.pack, c))}</td></tr>`;
    })
    .join('');
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"/>',
    `<title>${escapeHtml(ctx.pack.code)} Marksheet Pack</title>`,
    '<style>body{font-family:Georgia,serif;margin:2rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #333;padding:.4rem;text-align:left}.mark{font-size:.8rem;color:#666}</style>',
    '</head><body>',
    `<h1>${escapeHtml(ctx.pack.name)}</h1>`,
    `<p class="mark">${escapeHtml(ctx.pack.securityMark)} · ${escapeHtml(ctx.institutionCode)} · ${escapeHtml(ctx.affiliationCode)}</p>`,
    '<table><thead><tr><th>ID</th><th>Name</th><th>Subjects</th><th>Result</th></tr></thead>',
    `<tbody>${rows}</tbody></table>`,
    '</body></html>',
  ].join('');
}

export function writeBoardExportArtifacts(ctx: BoardExportContext): BoardExportArtifacts {
  const root = ctx.artifactRoot ?? defaultArtifactRoot();
  const artifactDir = join(root, ctx.pack.code, ctx.jobId);
  mkdirSync(artifactDir, { recursive: true });

  const marksheetCsv = buildMarksheetCsv(ctx);
  const examResults = buildExamResultsJson(ctx);
  const pdfLite = buildPdfLiteHtml(ctx);
  const packPayload = {
    jobId: ctx.jobId,
    tenantId: ctx.tenantId,
    boardId: ctx.boardId,
    boardCode: ctx.pack.code,
    packVersion: ctx.pack.version,
    securityMark: ctx.pack.securityMark,
    fieldMap: {
      marksheet: ctx.pack.marksheetFields,
      examResults: ctx.pack.examResultFields,
      terminology: ctx.pack.terminology,
    },
    institution: {
      id: ctx.institutionId,
      code: ctx.institutionCode,
      name: ctx.institutionName,
      affiliationCode: ctx.affiliationCode,
      centreCode: ctx.centreCode,
    },
    generatedAt: new Date().toISOString(),
    candidateCount: ctx.candidates.length,
    examResults,
  };
  const packJson = `${JSON.stringify(packPayload, null, 2)}\n`;

  const marksheetCsvPath = join(artifactDir, 'marksheet.csv');
  const examResultsJsonPath = join(artifactDir, 'exam-results.json');
  const pdfLitePath = join(artifactDir, 'marksheet.pdf-lite.html');
  const packJsonPath = join(artifactDir, 'pack.json');

  writeFileSync(marksheetCsvPath, marksheetCsv, 'utf8');
  writeFileSync(examResultsJsonPath, `${JSON.stringify(examResults, null, 2)}\n`, 'utf8');
  writeFileSync(pdfLitePath, pdfLite, 'utf8');
  writeFileSync(packJsonPath, packJson, 'utf8');

  const checksumSha256 = createHash('sha256').update(packJson).digest('hex');

  return {
    artifactDir,
    packJsonPath,
    marksheetCsvPath,
    examResultsJsonPath,
    pdfLitePath,
    checksumSha256,
    candidateCount: ctx.candidates.length,
    marksheetCsv,
    packJson,
  };
}
