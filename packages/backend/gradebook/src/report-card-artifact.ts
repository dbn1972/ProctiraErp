/**
 * PRC-M265: report-card HTML artifacts persisted to storage so a SUCCEEDED job
 * is always downloadable. Layout: `<root>/<tenant>/<jobId>.html`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { AppError } from '@proctira/common';

import { transcriptArtifactRoot } from './transcript-artifact.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function reportCardArtifactRoot(): string {
  return process.env.SIS_REPORT_CARD_DIR ?? join(transcriptArtifactRoot(), 'report-cards');
}

/** Tenant/job ids become path segments: UUID-only and confined to the root. */
export function reportCardArtifactPath(tenantId: string, jobId: string): string {
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(jobId)) {
    throw new AppError('Invalid report card artifact scope', 'VALIDATION_ERROR', 400);
  }
  const root = resolve(reportCardArtifactRoot());
  const path = resolve(root, tenantId, `${jobId}.html`);
  if (!path.startsWith(root + sep)) {
    throw new AppError('Report card artifact path escapes storage root', 'VALIDATION_ERROR', 400);
  }
  return path;
}

export function escapeReportCardHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function writeReportCardArtifact(tenantId: string, jobId: string, html: string): string {
  const path = reportCardArtifactPath(tenantId, jobId);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, html, 'utf8');
  return path;
}

export function readReportCardArtifact(tenantId: string, jobId: string): Buffer {
  return readFileSync(reportCardArtifactPath(tenantId, jobId));
}
