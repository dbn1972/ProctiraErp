/**
 * PRC-M299: a learner submits, uploads to a submission and posts in a
 * discussion only where they are ENROLLED: the assignment's section when it
 * names one, otherwise its school (and the discussion's school).
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import { lmsPlugin } from './lms-plugin.js';
import { LmsService, type LmsLearnerMembership } from './lms-service.js';

const TENANT = randomUUID();
const SCHOOL = randomUUID();
const SECTION = randomUUID();
const IN_SECTION = randomUUID();
const SCHOOL_ONLY = randomUUID();
const OUTSIDER = randomUUID();

interface Principal {
  sub: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string }>;
  institutions: string[];
}
function principal(roleId: string, sub: string = randomUUID()): Principal {
  return { sub, roles: [{ roleId, roleName: roleId, areaId: 'root' }], institutions: [] };
}
const teacher = { ...principal('teacher'), institutions: [SCHOOL] };

describe('LMS learner enrolment checks (PRC-M299)', () => {
  let app: FastifyInstance;
  let sectionMembers: Set<string>;
  let schoolMembers: Set<string>;

  beforeEach(async () => {
    sectionMembers = new Set([IN_SECTION]);
    schoolMembers = new Set([IN_SECTION, SCHOOL_ONLY]);
    const learnerMembership: LmsLearnerMembership = {
      inSection: async (_t, userId, sectionId) =>
        sectionId === SECTION && sectionMembers.has(userId),
      inInstitution: async (_t, userId, institutionId) =>
        institutionId === SCHOOL && schoolMembers.has(userId),
    };
    const repository = new InMemoryLmsRepository();
    app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      (request as unknown as { user: Principal }).user = JSON.parse(
        String(request.headers['x-test-principal']),
      ) as Principal;
    });
    await app.register(lmsPlugin, {
      repository,
      service: new LmsService(repository, { learnerMembership }),
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const as = (who: Principal) => ({ 'x-test-principal': JSON.stringify(who) });

  async function assignment(sectionId?: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/lms/assignments',
      headers: as(teacher),
      payload: {
        scope: 'school',
        institutionId: SCHOOL,
        ...(sectionId ? { sectionId } : {}),
        kind: 'homework',
        title: 'Essay',
        subject: 'English',
        publish: true,
      },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { id: string }).id;
  }

  const submit = (assignmentId: string, studentId: string) =>
    app.inject({
      method: 'POST',
      url: `/lms/assignments/${assignmentId}/submissions`,
      headers: as(principal('student', studentId)),
      payload: { studentId, institutionId: SCHOOL, content: 'My essay' },
    });

  it("a learner cannot submit to another section's assignment", async () => {
    const id = await assignment(SECTION);
    expect((await submit(id, SCHOOL_ONLY)).statusCode).toBe(403);
    expect((await submit(id, IN_SECTION)).statusCode).toBe(201);
  });

  it("a learner cannot submit to another school's assignment", async () => {
    const id = await assignment();
    expect((await submit(id, OUTSIDER)).statusCode).toBe(403);
    expect((await submit(id, SCHOOL_ONLY)).statusCode).toBe(201);
  });

  it('a learner whose enrolment ended cannot upload to their submission (service)', async () => {
    // The HTTP upload route is staff-only in the package guard; the service check
    // covers every other caller of uploadAssignmentFile.
    const id = await assignment();
    const submitted = await submit(id, SCHOOL_ONLY);
    expect(submitted.statusCode).toBe(201);
    schoolMembers.delete(SCHOOL_ONLY);
    const service = (app as unknown as { lmsService: LmsService }).lmsService;
    await expect(
      service.uploadAssignmentFile(
        TENANT,
        id,
        {
          filename: 'essay.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from('draft').toString('base64'),
          submissionId: (submitted.json() as { id: string }).id,
        },
        { userId: SCHOOL_ONLY, roles: ['student'], institutions: [] },
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("a learner cannot post in another school's discussion", async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/lms/discussions',
      headers: as(teacher),
      payload: { institutionId: SCHOOL, classKey: '7-A', title: 'Questions' },
    });
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    const post = (studentId: string) =>
      app.inject({
        method: 'POST',
        url: `/lms/discussions/${id}/posts`,
        headers: as(principal('student', studentId)),
        payload: { body: 'Hello' },
      });
    expect((await post(OUTSIDER)).statusCode).toBe(403);
    expect((await post(SCHOOL_ONLY)).statusCode).toBe(201);
  });
});

describe('LMS learner writes without an enrolment lookup (PRC-M299)', () => {
  it('fail closed in production-like environments', async () => {
    const repository = new InMemoryLmsRepository();
    const staff = new LmsService(repository, { nodeEnv: 'production' });
    const teacherActor = { userId: randomUUID(), roles: ['teacher'], institutions: [SCHOOL] };
    const created = await staff.createAssignment(
      TENANT,
      {
        scope: 'school',
        institutionId: SCHOOL,
        kind: 'homework',
        title: 'Essay',
        subject: 'English',
        publish: true,
      } as never,
      teacherActor,
    );
    const student = { userId: IN_SECTION, roles: ['student'], institutions: [] };
    await expect(
      staff.submit(TENANT, created.id, { studentId: IN_SECTION, content: 'x' }, student),
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
