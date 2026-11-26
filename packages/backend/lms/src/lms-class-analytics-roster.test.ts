/**
 * PRC-M302: class analytics uses the real SIS roster for a section classKey
 * (rosterSize, missingStudentIds) and flags truncation instead of presenting a
 * submitters-only roster and silently cut data as complete.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import { CLASS_ANALYTICS_SUBMISSION_LIMIT, LmsService } from './lms-service.js';

const TENANT = randomUUID();
const SCHOOL = randomUUID();
const SECTION = randomUUID();
const teacher = { userId: randomUUID(), roles: ['teacher'], institutions: [SCHOOL] };
const learner = (id: string) => ({ userId: id, roles: ['student'], institutions: [SCHOOL] });

async function sectionHomework(svc: LmsService) {
  return svc.createAssignment(
    TENANT,
    {
      scope: 'school',
      institutionId: SCHOOL,
      sectionId: SECTION,
      kind: 'homework',
      title: 'Essay',
      subject: 'English',
      gradeLevel: '7',
      maxScore: 10,
      publish: true,
    },
    teacher,
  );
}

describe('class analytics roster (PRC-M302)', () => {
  it('uses the SIS section roster and lists who has not submitted', async () => {
    const repo = new InMemoryLmsRepository();
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const sectionRoster = vi.fn(async () => ({ studentIds: [a, b, c], truncated: false }));
    const svc = new LmsService(repo, { classRoster: { sectionRoster } });
    const hw = await sectionHomework(svc);
    await svc.submit(
      TENANT,
      hw.id,
      { studentId: a, institutionId: SCHOOL, content: 'x' },
      learner(a),
    );

    const analytics = await svc.getClassAnalytics(
      TENANT,
      { classKey: SECTION, institutionId: SCHOOL },
      teacher,
    );

    expect(sectionRoster).toHaveBeenCalledWith(TENANT, SECTION);
    expect(analytics).toMatchObject({
      rosterSource: 'sis',
      rosterSize: 3,
      uniqueStudents: 1,
      truncated: false,
    });
    expect([...analytics.missingStudentIds].sort()).toEqual([b, c].sort());
    expect(analytics.submissionRate).toBeCloseTo(1 / 3, 4);
  });

  it('labels a submitters-only roster when no SIS roster applies', async () => {
    const repo = new InMemoryLmsRepository();
    const sectionRoster = vi.fn();
    const svc = new LmsService(repo, { classRoster: { sectionRoster } });
    const hw = await sectionHomework(svc);
    const a = randomUUID();
    await svc.submit(
      TENANT,
      hw.id,
      { studentId: a, institutionId: SCHOOL, content: 'x' },
      learner(a),
    );

    // A grade-level classKey is not a section: no roster lookup.
    const byGrade = await svc.getClassAnalytics(
      TENANT,
      { classKey: '7', institutionId: SCHOOL },
      teacher,
    );
    expect(sectionRoster).not.toHaveBeenCalled();
    expect(byGrade).toMatchObject({ rosterSource: 'submissions', rosterSize: 1 });
    expect(byGrade.missingStudentIds).toEqual([]);

    // No roster port configured at all.
    const plain = new LmsService(repo);
    expect(
      await plain.getClassAnalytics(TENANT, { classKey: SECTION, institutionId: SCHOOL }, teacher),
    ).toMatchObject({ rosterSource: 'submissions' });
  });

  it('flags truncation when the submission window or roster is cut', async () => {
    const repo = new InMemoryLmsRepository();
    const roster = { studentIds: [] as string[], truncated: false };
    const svc = new LmsService(repo, { classRoster: { sectionRoster: async () => roster } });
    const hw = await sectionHomework(svc);
    const submissions = Array.from({ length: CLASS_ANALYTICS_SUBMISSION_LIMIT + 1 }, () => ({
      id: randomUUID(),
      assignmentId: hw.id,
      studentId: randomUUID(),
      score: null,
      answers: [],
    }));
    vi.spyOn(repo, 'listSubmissionsForAssignments').mockResolvedValue(submissions as never);

    const cut = await svc.getClassAnalytics(TENANT, { classKey: SECTION }, teacher);
    expect(cut.truncated).toBe(true);
    expect(cut.submissionCount).toBe(CLASS_ANALYTICS_SUBMISSION_LIMIT);

    vi.mocked(repo.listSubmissionsForAssignments).mockResolvedValue([]);
    expect((await svc.getClassAnalytics(TENANT, { classKey: SECTION }, teacher)).truncated).toBe(
      false,
    );
    roster.truncated = true;
    expect((await svc.getClassAnalytics(TENANT, { classKey: SECTION }, teacher)).truncated).toBe(
      true,
    );
  });
});
