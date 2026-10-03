/**
 * PRC-M267: transcript snapshot ownership, version race, artifacts after insert.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  BOARD,
  SECTION,
  STUDENT,
  STUDENT_B,
  TENANT,
  setupGradebook,
} from './gradebook-test-setup.js';
import { transcriptArtifactPaths } from './transcript-artifact.js';

async function seedGpa(service: ReturnType<typeof setupGradebook>['service'], studentId: string) {
  await service.upsertGradeEntry(TENANT, {
    sectionId: SECTION,
    studentId,
    assessmentCode: 'MATH',
    numericScore: 95,
  });
  return (await service.computeGpa(TENANT, { studentId, boardId: BOARD })).snapshot;
}

describe('PRC-M267 transcript issue integrity', () => {
  it("another student's snapshot -> 422", async () => {
    const { service } = setupGradebook();
    const other = await seedGpa(service, STUDENT_B);
    await expect(
      service.issueTranscript(TENANT, { studentId: STUDENT, gpaSnapshotId: other.id }),
    ).rejects.toMatchObject({ statusCode: 422 });
    expect(existsSync(transcriptArtifactPaths(TENANT, STUDENT, 1).pdfPath)).toBe(false);
  });

  it('parallel issue -> versions 1 and 2 or 409, and no orphan files', async () => {
    const { service } = setupGradebook();
    await seedGpa(service, STUDENT);
    const results = await Promise.allSettled([
      service.issueTranscript(TENANT, { studentId: STUDENT }),
      service.issueTranscript(TENANT, { studentId: STUDENT }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled') as Array<
      PromiseFulfilledResult<{ version: number; metadata: Record<string, unknown> }>
    >;
    for (const r of results) {
      if (r.status === 'rejected') {
        expect((r.reason as { statusCode?: number }).statusCode).toBe(409);
      }
    }
    const versions = ok.map((r) => r.value.version).sort();
    expect(new Set(versions).size).toBe(versions.length);
    // every written version dir belongs to an inserted row
    for (const v of [1, 2]) {
      const has = existsSync(transcriptArtifactPaths(TENANT, STUDENT, v).pdfPath);
      expect(has).toBe(versions.includes(v));
    }
    // checksum over the PDF bytes is recorded
    const first = ok[0]!.value;
    const pdf = readFileSync(transcriptArtifactPaths(TENANT, STUDENT, first.version).pdfPath);
    expect(first.metadata.pdfSha256).toBe(createHash('sha256').update(pdf).digest('hex'));
  });
});
