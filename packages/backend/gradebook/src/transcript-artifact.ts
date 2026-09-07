/**
 * Transcript / report-card PDF-lite HTML artifacts (not crypto-sealed).
 * Mirrors board-export pdf-lite pattern.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

export function writeTranscriptPdfLite(input: {
  tenantId: string;
  studentId: string;
  version: number;
  issuedAt: string;
  weightedGpa: number | null;
  unweightedGpa: number | null;
  creditsEarned: number | null;
  checksumSha256: string;
}): { artifactDir: string; pdfLitePath: string; jsonPath: string } {
  const artifactDir = join(
    transcriptArtifactRoot(),
    input.tenantId,
    input.studentId,
    `v${input.version}`,
  );
  mkdirSync(artifactDir, { recursive: true });
  const pdfLitePath = join(artifactDir, 'transcript.pdf-lite.html');
  const jsonPath = join(artifactDir, 'transcript.json');
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
  return { artifactDir, pdfLitePath, jsonPath };
}
