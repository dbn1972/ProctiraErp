/**
 * Shared test fixture for audit-gap regression tests (not exported from the package).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GradebookService } from './gradebook-service.js';
import { InMemoryGradebookRepository } from './in-memory-repository.js';

export const TENANT = '11111111-1111-4111-8111-111111111111';
export const BOARD = '22222222-2222-4222-8222-222222222222';
export const STUDENT = '33333333-3333-4333-8333-333333333333';
export const STUDENT_B = '33333333-3333-4333-8333-3333333333bb';
export const SECTION = '44444444-4444-4444-8444-444444444444';
export const SCALE = '55555555-5555-4555-8555-555555555555';

export function setupGradebook(): { repo: InMemoryGradebookRepository; service: GradebookService } {
  process.env.SIS_TRANSCRIPT_DIR = mkdtempSync(join(tmpdir(), 'sis-transcripts-'));
  process.env.TRANSCRIPT_SIGNING_SECRET = 'gradebook-test-transcript-signing-secret';
  process.env.TRANSCRIPT_SIGNING_KMS_KEY_REF = 'env:TRANSCRIPT_SIGNING_SECRET';
  const repo = new InMemoryGradebookRepository();
  repo.seedSection({
    id: SECTION,
    tenantId: TENANT,
    institutionId: '66666666-6666-4666-8666-666666666666',
    academicPeriodId: '77777777-7777-4777-8777-777777777777',
    code: '10-A',
    name: 'Class 10-A',
    status: 'PUBLISHED',
  });
  repo.seedBoard({ id: BOARD, tenantId: TENANT, code: 'CBSE', name: 'CBSE' });
  repo.seedScale({
    id: SCALE,
    tenantId: TENANT,
    boardId: BOARD,
    code: 'CBSE-9PT',
    name: 'CBSE 9-point',
    scaleType: 'PERCENT_BAND',
    isDefault: true,
    bands: [
      { label: 'A1', minPercent: 91, maxPercent: 100, gradePoints: 10 },
      { label: 'A2', minPercent: 81, maxPercent: 90.99, gradePoints: 9 },
      { label: 'E', minPercent: 0, maxPercent: 32.99, gradePoints: 0 },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return { repo, service: new GradebookService(repo) };
}
