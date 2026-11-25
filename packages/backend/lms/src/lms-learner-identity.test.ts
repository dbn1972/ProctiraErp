/**
 * PRC-L331: a learner's LMS records are keyed by the SIS student id the JWT sub
 * maps to (students.id / custom_data.user_id), never by the raw sub.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { InMemoryLmsRepository } from './in-memory-repository.js';
import { LmsService, type LmsActor, type LmsLearnerMembership } from './lms-service.js';

const TENANT = randomUUID();
const SCHOOL = randomUUID();
const LEARNER_SUB = randomUUID();
const STUDENT_ID = randomUUID();

const teacher: LmsActor = { userId: randomUUID(), roles: ['teacher'], institutions: [SCHOOL] };
const learner: LmsActor = { userId: LEARNER_SUB, roles: ['student'], institutions: [] };

function membership(map: Record<string, string[]>): LmsLearnerMembership {
  return {
    inSection: async () => true,
    inInstitution: async (_t, userId) => userId in map,
    studentIdsForLearner: async (_t, userId) => map[userId] ?? [],
  };
}

async function publishedAssignment(service: LmsService) {
  return service.createAssignment(
    TENANT,
    {
      scope: 'school',
      institutionId: SCHOOL,
      kind: 'homework',
      title: 'Essay',
      subject: 'English',
      publish: true,
    } as never,
    teacher,
  );
}

describe('PRC-L331 learner identity -> SIS student id', () => {
  it('stores the submission under the mapped student id and refuses the raw sub', async () => {
    const repository = new InMemoryLmsRepository();
    const service = new LmsService(repository, {
      learnerMembership: membership({ [LEARNER_SUB]: [STUDENT_ID] }),
    });
    const assignment = await publishedAssignment(service);

    await expect(
      service.submit(TENANT, assignment.id, { studentId: LEARNER_SUB, content: 'x' }, learner),
    ).rejects.toMatchObject({ statusCode: 403 });

    const submission = await service.submit(
      TENANT,
      assignment.id,
      { studentId: STUDENT_ID, content: 'My essay' },
      learner,
    );
    expect(submission.studentId).toBe(STUDENT_ID);

    const listed = await service.listSubmissions(TENANT, {}, { page: 1, pageSize: 20 }, learner);
    expect(listed.data.map((s) => s.studentId)).toEqual([STUDENT_ID]);
    expect((await service.getSubmission(TENANT, submission.id, learner)).id).toBe(submission.id);
  });

  it('PAL reads use the mapped id; another student id is refused', async () => {
    const service = new LmsService(new InMemoryLmsRepository(), {
      learnerMembership: membership({ [LEARNER_SUB]: [STUDENT_ID] }),
    });
    await expect(service.getProgress(TENANT, STUDENT_ID, {}, learner)).resolves.toMatchObject({
      studentId: STUDENT_ID,
    });
    await expect(service.getProgress(TENANT, LEARNER_SUB, {}, learner)).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it('a learner with no linked student record cannot list submissions', async () => {
    const service = new LmsService(new InMemoryLmsRepository(), {
      learnerMembership: membership({}),
    });
    await expect(
      service.listSubmissions(TENANT, {}, { page: 1, pageSize: 20 }, learner),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('production-like without a learner directory refuses learner reads (503)', async () => {
    const service = new LmsService(new InMemoryLmsRepository(), { nodeEnv: 'production' });
    await expect(service.getProgress(TENANT, LEARNER_SUB, {}, learner)).rejects.toMatchObject({
      statusCode: 503,
    });
  });
});
