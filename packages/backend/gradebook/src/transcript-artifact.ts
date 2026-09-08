/**
 * Official transcript artifacts.
 *
 * Each issue writes three files under `SIS_TRANSCRIPT_DIR/<tenant>/<student>/v<n>/`:
 *  - `transcript.pdf`            real PDF (G-716, via `@proctira/pdf-lite`)
 *  - `transcript.pdf-lite.html`  printable HTML kept for backwards compatibility
 *  - `transcript.json`           machine-readable payload + checksum
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PdfDocument, PdfFlow } from '@proctira/pdf-lite';

export function transcriptArtifactRoot(): string {
  return process.env.SIS_TRANSCRIPT_DIR ?? '/opt/cursor/artifacts/sis-transcripts';
}

export function buildTranscriptPdfLiteHtml(input: {
  studentId: string;
  version: number;
  issuedAt: string;
  weightedGpa: number | null;
  unweightedGpa: number | null;
  creditsEarned: number | null;
  checksumSha256: string;
}): string {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8"/>',
    `<title>Official transcript v${input.version}</title>`,
    '<style>body{font-family:Georgia,serif;margin:2rem}h1{font-size:1.4rem}.meta{color:#555;font-size:.9rem}table{border-collapse:collapse;margin-top:1rem}td,th{border:1px solid #333;padding:.4rem;text-align:left}</style>',
    '</head><body>',
    '<h1>Official transcript (PDF-lite)</h1>',
    `<p class="meta">Not a cryptographically sealed PDF — printable HTML artifact.</p>`,
    '<table>',
    `<tr><th>Student ID</th><td>${input.studentId}</td></tr>`,
    `<tr><th>Version</th><td>${input.version}</td></tr>`,
    `<tr><th>Issued at</th><td>${input.issuedAt}</td></tr>`,
    `<tr><th>Weighted GPA</th><td>${input.weightedGpa ?? '—'}</td></tr>`,
    `<tr><th>Unweighted GPA</th><td>${input.unweightedGpa ?? '—'}</td></tr>`,
    `<tr><th>Credits earned</th><td>${input.creditsEarned ?? '—'}</td></tr>`,
    `<tr><th>Checksum (SHA-256)</th><td><code>${input.checksumSha256}</code></td></tr>`,
    '</table>',
    '</body></html>',
  ].join('');
}

export interface TranscriptArtifactInput {
  studentId: string;
  version: number;
  issuedAt: string;
  weightedGpa: number | null;
  unweightedGpa: number | null;
  creditsEarned: number | null;
  checksumSha256: string;
  institutionName?: string | null;
  studentName?: string | null;
  signature?: string | null;
}

/** Renders the official transcript as real PDF bytes. */
export function buildTranscriptPdf(input: TranscriptArtifactInput): Buffer {
  const institution = input.institutionName?.trim() || 'ProctiraERP';
  const doc = new PdfDocument({
    title: `Official transcript v${input.version} - ${input.studentName ?? input.studentId}`,
    author: institution,
    creationDate: new Date(input.issuedAt),
  });
  const flow = new PdfFlow(doc, {
    header: institution,
    footer: `SHA-256 ${input.checksumSha256} - Page {page} of {pages}`,
  });
  flow.heading('Official Transcript', 18);
  flow.paragraph(`Version ${input.version} issued ${input.issuedAt}`, { size: 9, grey: 0.35 });
  flow.spacer(6);
  flow.keyValue('Student', input.studentName?.trim() || input.studentId);
  if (input.studentName) flow.keyValue('Student ID', input.studentId);
  flow.horizontalRule();
  flow.subheading('Academic standing');
  flow.table(
    [
      { header: 'Measure', weight: 2 },
      { header: 'Value', weight: 1, align: 'right' },
    ],
    [
      ['Weighted GPA', input.weightedGpa === null ? '-' : input.weightedGpa.toFixed(2)],
      ['Unweighted GPA', input.unweightedGpa === null ? '-' : input.unweightedGpa.toFixed(2)],
      ['Credits earned', input.creditsEarned === null ? '-' : String(input.creditsEarned)],
    ],
  );
  flow.horizontalRule();
  flow.subheading('Integrity');
  flow.keyValue('Checksum (SHA-256)', input.checksumSha256);
  if (input.signature) flow.keyValue('Signature (HMAC-SHA256)', input.signature);
  flow.paragraph(
    'This transcript is immutable once issued; later corrections are published as a new version. ' +
      'Verify the checksum against the issuing institution\'s records.',
    { size: 8, grey: 0.4 },
  );
  return flow.finish();
}

export function writeTranscriptPdfLite(input: {
  tenantId: string;
  studentId: string;
  version: number;
  issuedAt: string;
  weightedGpa: number | null;
  unweightedGpa: number | null;
  creditsEarned: number | null;
  checksumSha256: string;
  institutionName?: string | null;
  studentName?: string | null;
  signature?: string | null;
}): { artifactDir: string; pdfPath: string; pdfLitePath: string; jsonPath: string } {
  const artifactDir = join(
    transcriptArtifactRoot(),
    input.tenantId,
    input.studentId,
    `v${input.version}`,
  );
  mkdirSync(artifactDir, { recursive: true });
  const pdfPath = join(artifactDir, 'transcript.pdf');
  const pdfLitePath = join(artifactDir, 'transcript.pdf-lite.html');
  const jsonPath = join(artifactDir, 'transcript.json');
  writeFileSync(pdfPath, buildTranscriptPdf(input));
  const html = buildTranscriptPdfLiteHtml(input);
  writeFileSync(pdfLitePath, html, 'utf8');
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        studentId: input.studentId,
        version: input.version,
        issuedAt: input.issuedAt,
        weightedGpa: input.weightedGpa,
        unweightedGpa: input.unweightedGpa,
        creditsEarned: input.creditsEarned,
        checksumSha256: input.checksumSha256,
      },
      null,
      2,
    ),
    'utf8',
  );
  return { artifactDir, pdfPath, pdfLitePath, jsonPath };
}
