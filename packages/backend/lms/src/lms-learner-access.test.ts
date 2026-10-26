/**
 * PRC-L574: HTTP-level coverage for the restricted-principal paths that were
 * untested — guardian role, submission-file ownership, cross-tenant file reads
 * and concurrent duplicate submissions. (PAL idempotency is covered by
 * lms-pal-idempotency.test.ts, PRC-M295 / PRC-M296.)
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryLmsRepository } from './in-memory-repository.js';
import { lmsPlugin } from './lms-plugin.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const SCHOOL = randomUUID();
const STUDENT_A = randomUUID();
const STUDENT_B = randomUUID();

interface Principal {
  sub: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string }>;
  institutions: string[];
}

function principal(roleId: string, sub: string = randomUUID()): Principal {
  return { sub, roles: [{ roleId, roleName: roleId, areaId: 'root' }], institutions: [SCHOOL] };
}

const teacher = principal('teacher');
const guardian = principal('guardian');
const studentA = principal('student', STUDENT_A);
const studentB = principal('student', STUDENT_B);

function createApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null as unknown as Principal);
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = String(request.headers['x-tenant-id']);
    (request as unknown as { user: Principal }).user = JSON.parse(
      String(request.headers['x-test-principal']),
    ) as Principal;
  });
  return app;
}

function as(who: Principal, tenantId = TENANT_A) {
  return { 'x-tenant-id': tenantId, 'x-test-principal': JSON.stringify(who) };
}

describe('PRC-L574 — LMS restricted-principal paths', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = createApp();
    await app.register(lmsPlugin, { repository: new InMemoryLmsRepository() });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  async function createQuiz(publish: boolean) {
    const res = await app.inject({
      method: 'POST',
      url: '/lms/assignments',
      headers: as(teacher),
      payload: {
        scope: 'school',
        institutionId: SCHOOL,
        kind: 'quiz',
        title: publish ? 'Published quiz' : 'Draft quiz',
        subject: 'Maths',
        publish,
        questions: [{ prompt: '1 + 1', options: ['2', '3'], correctOptionIndex: 0 }],
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json() as { id: string; questions: Array<{ id: string }> };
  }

  async function submit(quiz: { id: string; questions: Array<{ id: string }> }, who: Principal) {
    return app.inject({
      method: 'POST',
      url: `/lms/assignments/${quiz.id}/submissions`,
      headers: as(who),
      payload: {
        studentId: who.sub,
        institutionId: SCHOOL,
        answers: [{ questionId: quiz.questions[0]!.id, selectedOptionIndex: 0 }],
      },
    });
  }

  describe('guardian role', () => {
    it('sees a published assignment without the answer key', async () => {
      const quiz = await createQuiz(true);
      const res = await app.inject({
        method: 'GET',
        url: `/lms/assignments/${quiz.id}`,
        headers: as(guardian),
      });
      expect(res.statusCode).toBe(200);
      const questions = (
        res.json() as {
          questions: Array<{ correctOptionIndex: number; payload?: Record<string, unknown> }>;
        }
      ).questions;
      expect(questions).toHaveLength(1);
      expect(questions.every((q) => q.correctOptionIndex === -1)).toBe(true);
      expect(questions.every((q) => q.payload?.['correctOptionIndex'] === undefined)).toBe(true);
    });

    it('cannot see drafts or list submissions', async () => {
      const draft = await createQuiz(false);
      const getDraft = await app.inject({
        method: 'GET',
        url: `/lms/assignments/${draft.id}`,
        headers: as(guardian),
      });
      expect(getDraft.statusCode).toBe(404);
      const list = await app.inject({
        method: 'GET',
        url: '/lms/submissions',
        headers: as(guardian),
      });
      expect(list.statusCode).toBe(403);
    });
  });

  describe('submission file ownership', () => {
    async function seedSubmissionFile() {
      const quiz = await createQuiz(true);
      const submitted = await submit(quiz, studentA);
      expect(submitted.statusCode).toBe(201);
      const submissionId = (submitted.json() as { id: string }).id;
      const uploaded = await app.inject({
        method: 'POST',
        url: `/lms/assignments/${quiz.id}/files`,
        headers: as(teacher),
        payload: {
          filename: 'feedback.txt',
          mimeType: 'text/plain',
          contentBase64: Buffer.from('well done').toString('base64'),
          submissionId,
        },
      });
      expect(uploaded.statusCode).toBe(201);
      return (uploaded.json() as { id: string }).id;
    }

    async function signedDownload(fileId: string, who: Principal, tenantId = TENANT_A) {
      return app.inject({
        method: 'POST',
        url: `/lms/files/${fileId}/signed-download`,
        headers: as(who, tenantId),
      });
    }

    it('lets the owning student and staff read the file, but not another student', async () => {
      const fileId = await seedSubmissionFile();

      const staffSigned = await signedDownload(fileId, teacher);
      expect(staffSigned.statusCode).toBe(200);
      const { token } = staffSigned.json() as { token: string };
      const download = (who: Principal) =>
        app.inject({
          method: 'GET',
          url: `/lms/files/${fileId}/download?token=${encodeURIComponent(token)}`,
          headers: as(who),
        });

      expect((await download(teacher)).statusCode).toBe(200);
      const ownerDownload = await download(studentA);
      expect(ownerDownload.statusCode).toBe(200);
      expect(ownerDownload.body).toBe('well done');

      // Even holding a valid token, another student cannot download it.
      const otherDownload = await download(studentB);
      expect(otherDownload.statusCode).toBe(404);
      expect(otherDownload.body).not.toContain('well done');
      expect([403, 404]).toContain((await signedDownload(fileId, studentB)).statusCode);

      // Service-level ownership on the signing path (the HTTP guard classifies
      // POST signed-download as a staff action, so learners are refused there).
      const service = app.lmsService;
      const asActor = (who: Principal) => ({
        userId: who.sub,
        roles: who.roles.map((r) => r.roleId),
        institutions: who.institutions,
      });
      await expect(
        service.signedFileDownload(TENANT_A, fileId, asActor(studentA)),
      ).resolves.toMatchObject({ id: fileId });
      await expect(
        service.signedFileDownload(TENANT_A, fileId, asActor(studentB)),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('never serves a tenant A file to tenant B', async () => {
      const fileId = await seedSubmissionFile();
      expect((await signedDownload(fileId, teacher, TENANT_B)).statusCode).toBe(404);
      const listed = await app.inject({
        method: 'GET',
        url: `/lms/files/${fileId}/download?token=bogus`,
        headers: as(teacher, TENANT_B),
      });
      expect(listed.statusCode).toBe(404);
    });
  });

  it('two concurrent submissions by one student yield one 201 and one 409', async () => {
    const quiz = await createQuiz(true);
    const [first, second] = await Promise.all([submit(quiz, studentA), submit(quiz, studentA)]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
    const list = await app.inject({
      method: 'GET',
      url: `/lms/submissions?assignmentId=${quiz.id}`,
      headers: as(teacher),
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: unknown[] }).data).toHaveLength(1);
  });
});
