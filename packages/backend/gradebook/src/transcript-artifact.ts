/**
 * Official transcript artifacts.
 *
 * Each issue writes three files under `SIS_TRANSCRIPT_DIR/<tenant>/<student>/v<n>/`:
 *  - `transcript.pdf`            real PDF (G-716, via `@proctira/pdf-lite`)
 *  - `transcript.pdf-lite.html`  printable HTML kept for backwards compatibility
 *  - `transcript.json`           machine-readable payload + checksum
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { AppError } from '@proctira/common';
import { PdfDocument, PdfFlow } from '@proctira/pdf-lite';

export function transcriptArtifactRoot(): string {
  return process.env.SIS_TRANSCRIPT_DIR ?? '/opt/cursor/artifacts/sis-transcripts';
}

const UUID_SEGMENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PRC-H063: tenantId/studentId become filesystem path segments. studentId was client-supplied
 * with only `minLength: 1`, so `../../..` could escape the artifact root and write files anywhere
 * the process can. Only UUID segments are accepted, and the resolved directory must stay under
 * the artifact root (defense in depth against a future relaxed validator).
 */
export function resolveTranscriptArtifactDir(
  tenantId: string,
  studentId: string,
  version: number,
): string {
  if (!UUID_SEGMENT_RE.test(tenantId) || !UUID_SEGMENT_RE.test(studentId)) {
    throw new AppError('Invalid transcript artifact scope', 'VALIDATION_ERROR', 400);
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new AppError('Invalid transcript version', 'VALIDATION_ERROR', 400);
  }
  const root = resolve(transcriptArtifactRoot());
  const dir = resolve(root, tenantId, studentId, `v${version}`);
  if (dir !== root && !dir.startsWith(root + sep)) {
    throw new AppError('Transcript artifact path escapes storage root', 'VALIDATION_ERROR', 400);
  }
  return dir;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    `<tr><th>Student ID</th><td>${escapeHtml(input.studentId)}</td></tr>`,
    `<tr><th>Version</th><td>${escapeHtml(input.version)}</td></tr>`,
    `<tr><th>Issued at</th><td>${escapeHtml(input.issuedAt)}</td></tr>`,
    `<tr><th>Weighted GPA</th><td>${escapeHtml(input.weightedGpa ?? '—')}</td></tr>`,
    `<tr><th>Unweighted GPA</th><td>${escapeHtml(input.unweightedGpa ?? '—')}</td></tr>`,
    `<tr><th>Credits earned</th><td>${escapeHtml(input.creditsEarned ?? '—')}</td></tr>`,
    `<tr><th>Checksum (SHA-256)</th><td><code>${escapeHtml(input.checksumSha256)}</code></td></tr>`,
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
      "Verify the checksum against the issuing institution's records.",
    { size: 8, grey: 0.4 },
  );
  return flow.finish();
}

type TranscriptWriteInput = {
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
};

export type TranscriptArtifactPaths = {
  artifactDir: string;
  pdfPath: string;
  pdfLitePath: string;
  jsonPath: string;
};

/** PRC-M267: deterministic artifact paths (computed before the DB insert). */
export function transcriptArtifactPaths(
  tenantId: string,
  studentId: string,
  version: number,
): TranscriptArtifactPaths {
  const artifactDir = resolveTranscriptArtifactDir(tenantId, studentId, version);
  return {
    artifactDir,
    pdfPath: join(artifactDir, 'transcript.pdf'),
    pdfLitePath: join(artifactDir, 'transcript.pdf-lite.html'),
    jsonPath: join(artifactDir, 'transcript.json'),
  };
}

/** PRC-M267: build artifact bytes in memory (no filesystem side effects). */
export function buildTranscriptArtifacts(input: TranscriptWriteInput): {
  pdf: Buffer;
  html: string;
  json: string;
} {
  return {
    pdf: buildTranscriptPdf(input),
    html: buildTranscriptPdfLiteHtml(input),
    json: JSON.stringify(
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
  };
}

/** PRC-M267: write pre-built artifacts (called only after the DB row committed). */
export function persistTranscriptArtifacts(
  paths: TranscriptArtifactPaths,
  artifacts: { pdf: Buffer; html: string; json: string },
): void {
  mkdirSync(paths.artifactDir, { recursive: true });
  writeFileSync(paths.pdfPath, artifacts.pdf);
  writeFileSync(paths.pdfLitePath, artifacts.html, 'utf8');
  writeFileSync(paths.jsonPath, artifacts.json, 'utf8');
}

export function writeTranscriptPdfLite(input: TranscriptWriteInput): TranscriptArtifactPaths {
  const paths = transcriptArtifactPaths(input.tenantId, input.studentId, input.version);
  persistTranscriptArtifacts(paths, buildTranscriptArtifacts(input));
  return paths;
}
