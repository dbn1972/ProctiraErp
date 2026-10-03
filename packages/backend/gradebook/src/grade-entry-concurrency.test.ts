/**
 * PRC-M264: grade upsert/transition are compare-and-set; concurrent creates map to 409.
 */
import { describe, expect, it } from 'vitest';

import { SECTION, STUDENT, TENANT, setupGradebook } from './gradebook-test-setup.js';

const input = { sectionId: SECTION, studentId: STUDENT, assessmentCode: 'MATH', numericScore: 70 };

describe('PRC-M264 grade entry concurrency', () => {
  it('parallel identical creates -> one succeeds, the other 409 (no 500)', async () => {
    const { service } = setupGradebook();
    const results = await Promise.allSettled([
      service.upsertGradeEntry(TENANT, input),
      service.upsertGradeEntry(TENANT, input),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as { statusCode?: number }).statusCode).toBe(409);
  });

  it('lock vs edit race: edit rejected and locked value unchanged', async () => {
    const { repo, service } = setupGradebook();
    const created = await service.upsertGradeEntry(TENANT, input);
    // Simulate the edit having read the row before the lock committed.
    const realFind = repo.findGradeEntry.bind(repo);
    const staleRead = await realFind(TENANT, {
      studentId: STUDENT,
      sectionId: SECTION,
      assessmentCode: 'MATH',
    });
    await service.transitionGradeEntry(TENANT, created.id, 'submit');
    await service.transitionGradeEntry(TENANT, created.id, 'approve');
    await service.transitionGradeEntry(TENANT, created.id, 'lock');
    repo.findGradeEntry = async () => staleRead;
    await expect(
      service.upsertGradeEntry(TENANT, { ...input, numericScore: 99 }),
    ).rejects.toMatchObject({ statusCode: 409 });
    repo.findGradeEntry = realFind;
    const after = await repo.getGradeEntry(TENANT, created.id);
    expect(after?.numericScore).toBe(70);
    expect(after?.lockedAt).toBeTruthy();
  });

  it('stale transition is rejected with 409', async () => {
    const { repo, service } = setupGradebook();
    const created = await service.upsertGradeEntry(TENANT, input);
    const stale = await repo.getGradeEntry(TENANT, created.id);
    await service.transitionGradeEntry(TENANT, created.id, 'submit');
    const realGet = repo.getGradeEntry.bind(repo);
    repo.getGradeEntry = async () => stale;
    await expect(
      service.transitionGradeEntry(TENANT, created.id, 'submit'),
    ).rejects.toMatchObject({ statusCode: 409 });
    repo.getGradeEntry = realGet;
  });
});
