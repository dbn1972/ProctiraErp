import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { validate } from '@proctira/validation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IssueTranscriptSchema } from './schemas.js';
import {
  buildTranscriptPdfLiteHtml,
  resolveTranscriptArtifactDir,
  writeTranscriptPdfLite,
} from './transcript-artifact.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const STUDENT = '33333333-3333-4333-8333-333333333333';

/** PRC-H063: studentId is a filesystem path segment for transcript artifacts. */
describe('transcript artifact path safety (PRC-H063)', () => {
  let root: string;
  const saved = process.env.SIS_TRANSCRIPT_DIR;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'sis-transcripts-'));
    process.env.SIS_TRANSCRIPT_DIR = root;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    if (saved === undefined) delete process.env.SIS_TRANSCRIPT_DIR;
    else process.env.SIS_TRANSCRIPT_DIR = saved;
  });

  const base = {
    tenantId: TENANT,
    version: 1,
    issuedAt: '2026-01-01T00:00:00.000Z',
    weightedGpa: 3.5,
    unweightedGpa: 3.4,
    creditsEarned: 20,
    checksumSha256: 'a'.repeat(64),
  };

  it('rejects traversal studentIds at the schema layer', () => {
    for (const studentId of ['../../../etc', '..', 'a/b', STUDENT + '/../x', 'not-a-uuid']) {
      expect(validate(IssueTranscriptSchema, { studentId }).success, studentId).toBe(false);
    }
    expect(validate(IssueTranscriptSchema, { studentId: STUDENT }).success).toBe(true);
  });

  it('refuses to write outside the artifact root for a traversal studentId', () => {
    const escapeTarget = resolve(root, '..', 'escaped-h063');
    expect(() => writeTranscriptPdfLite({ ...base, studentId: '../../escaped-h063' })).toThrow(
      /invalid transcript artifact scope/i,
    );
    expect(existsSync(escapeTarget)).toBe(false);
  });

  it('refuses non-UUID tenant segments too', () => {
    expect(() => resolveTranscriptArtifactDir('../x', STUDENT, 1)).toThrow();
    expect(() => resolveTranscriptArtifactDir(TENANT, STUDENT, 0)).toThrow();
  });

  it('writes valid artifacts under <root>/<tenant>/<student>/v<n>', () => {
    const out = writeTranscriptPdfLite({ ...base, studentId: STUDENT });
    expect(out.artifactDir).toBe(resolve(root, TENANT, STUDENT, 'v1'));
    expect(existsSync(out.pdfPath)).toBe(true);
  });

  it('escapes interpolated values in the printable HTML', () => {
    const html = buildTranscriptPdfLiteHtml({
      ...base,
      studentId: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
