/**
 * PRC-M269: class rank uses bounded queries and writes no GPA snapshots.
 */
import { describe, expect, it } from 'vitest';

import { BOARD, SECTION, TENANT, setupGradebook } from './gradebook-test-setup.js';

const student = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;

describe('PRC-M269 class rank', () => {
  it('ranking 200 students issues bounded queries and creates 0 gpa_snapshots', async () => {
    const { repo, service } = setupGradebook();
    for (let i = 0; i < 200; i += 1) {
      await service.upsertGradeEntry(TENANT, {
        sectionId: SECTION,
        studentId: student(i),
        assessmentCode: 'MATH',
        numericScore: 40 + (i % 60),
      });
    }
    repo.gradeEntryQueries = 0;
    const before = (await Promise.all([0, 1, 2].map((i) => repo.listGpaSnapshots(TENANT, student(i)))))
      .flat().length;
    const result = await service.computeClassRank(TENANT, {
      sectionId: SECTION,
      boardId: BOARD,
      persist: false,
    } as never);
    expect(result.ranks).toHaveLength(200);
    expect(repo.gradeEntryQueries).toBe(2); // section entries + one batched student load
    let snapshots = 0;
    for (let i = 0; i < 200; i += 1) snapshots += (await repo.listGpaSnapshots(TENANT, student(i))).length;
    expect(snapshots).toBe(before);
    const top = result.ranks.find((r) => r.classRank === 1);
    expect(top?.weightedGpa).toBeGreaterThan(0);
  });
});
