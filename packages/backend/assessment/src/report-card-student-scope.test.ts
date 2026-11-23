/**
 * PRC-L274: report cards, comments and grades are minor data. A teacher-only
 * caller reads / generates them only for students they teach; guardians,
 * parents and students download only cards bound to them; everyone else is
 * refused before any bytes leave.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AssessmentPortalBinding, AssessmentTeachingScope } from './assessment-ownership.js';
import {
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
} from './in-memory-report-card-repository.js';
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import { InMemoryReportCardArtifactStore } from './report-card-artifact-store.js';
import { ReportCardPdfGenerator } from './report-card-pdf-generator.js';
import { registerReportCardRoutes } from './report-card-routes.js';
import { ReportCardService } from './report-card-service.js';
import { anyIdReportCardDirectory } from './report-card-test-directory.js';
import { registerResultRoutes } from './result-routes.js';
import { ResultService } from './result-service.js';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEACHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GUARDIAN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MINE = '33333333-3333-4333-8333-333333333333';
const OTHER = '55555555-5555-4555-8555-555555555555';
const SUBJECT = '11111111-1111-4111-8111-111111111111';
const PERIOD = '22222222-2222-4222-8222-222222222222';
const INSTITUTION = '66666666-6666-4666-8666-666666666666';

/** The teacher teaches MINE (and its subject) only. */
const scope: AssessmentTeachingScope = {
  teachesSubject: async (_t, principals, subjectId) =>
    principals.includes(TEACHER) && subjectId === SUBJECT,
  teachesStudent: async (_t, principals, studentId) =>
    principals.includes(TEACHER) && studentId === MINE,
};
/** The guardian is linked to MINE only. */
const portalBinding: AssessmentPortalBinding = {
  listReadableStudentIds: async (_t, userId) => (userId === GUARDIAN ? [MINE] : []),
};

describe('report-card per-student authorization (PRC-L274)', () => {
  let app: FastifyInstance;
  let user: { sub: string; roles: unknown[] } = { sub: TEACHER, roles: ['teacher'] };
  const jobs: Record<string, string> = {};

  beforeEach(async () => {
    const itemRepo = new InMemoryAssessmentItemRepository();
    const resultService = new ResultService(
      new InMemoryAssessmentResultRepository(),
      itemRepo,
      new InMemoryGradingSchemeRepository(),
    );
    const reportCardService = new ReportCardService(
      new InMemoryReportCardTemplateRepository(),
      new InMemoryTeacherCommentRepository(),
      new InMemoryInstitutionBrandingRepository(),
      new InMemoryReportCardJobRepository(),
      resultService,
      itemRepo,
      null,
      new ReportCardPdfGenerator(),
      {
        artifactStore: new InMemoryReportCardArtifactStore(),
        processInline: true,
        directory: anyIdReportCardDirectory,
      },
    );
    app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      (request as unknown as { user: unknown }).user = user;
    });
    await registerReportCardRoutes(app, { reportCardService, teachingScope: scope, portalBinding });
    await registerResultRoutes(app, { resultService, teachingScope: scope });
    await app.ready();
    // A coordinator sets up a template and one completed card per student.
    user = { sub: 'coord', roles: ['academic_coordinator'] };
    const template = await app.inject({
      method: 'POST',
      url: '/report-cards/templates',
      payload: { name: 'Default', templateContent: '<title>Term</title>', isDefault: true },
    });
    const templateId = (template.json() as { id: string }).id;
    for (const studentId of [MINE, OTHER]) {
      const gen = await app.inject({
        method: 'POST',
        url: '/report-cards/generate',
        payload: { studentId, academicPeriodId: PERIOD, templateId, institutionId: INSTITUTION },
      });
      expect(gen.statusCode).toBe(202);
      jobs[studentId] = (gen.json() as { id: string }).id;
    }
    user = { sub: TEACHER, roles: ['teacher'] };
  });

  afterEach(async () => {
    await app.close();
  });

  const download = (studentId: string) =>
    app.inject({ method: 'GET', url: `/report-cards/jobs/${jobs[studentId]}/download` });

  it('a teacher downloads and reads the job of a student they teach, not another', async () => {
    expect((await download(MINE)).statusCode).toBe(200);
    expect((await download(OTHER)).statusCode).toBe(403);
    const status = await app.inject({ method: 'GET', url: `/report-cards/jobs/${jobs[OTHER]}` });
    expect(status.statusCode).toBe(403);
  });

  it('a teacher reads comments and grades only of students they teach', async () => {
    const comments = await app.inject({
      method: 'GET',
      url: `/report-cards/comments?studentId=${OTHER}&academicPeriodId=${PERIOD}`,
    });
    expect(comments.statusCode).toBe(403);
    const grades = await app.inject({
      method: 'GET',
      url: `/results/grades?subjectId=${SUBJECT}&academicPeriodId=${PERIOD}&studentId=${OTHER}`,
    });
    expect(grades.statusCode).toBe(403);
    const own = await app.inject({
      method: 'GET',
      url: `/report-cards/comments?studentId=${MINE}&academicPeriodId=${PERIOD}`,
    });
    expect(own.statusCode).toBe(200);
  });

  it('a teacher cannot generate a card for a student they do not teach', async () => {
    const single = await app.inject({
      method: 'POST',
      url: '/report-cards/generate',
      payload: { studentId: OTHER, academicPeriodId: PERIOD, institutionId: INSTITUTION },
    });
    expect(single.statusCode).toBe(403);
    const bulk = await app.inject({
      method: 'POST',
      url: '/report-cards/generate/bulk',
      payload: { studentIds: [MINE, OTHER], academicPeriodId: PERIOD, institutionId: INSTITUTION },
    });
    expect(bulk.statusCode).toBe(403);
  });

  it("a guardian downloads their child's card and gets 404 for another child", async () => {
    user = { sub: GUARDIAN, roles: ['guardian'] };
    const own = await download(MINE);
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toBe('application/pdf');
    expect((await download(OTHER)).statusCode).toBe(404);
  });

  it('portal readers stay out of every other assessment route', async () => {
    user = { sub: GUARDIAN, roles: ['guardian'] };
    const status = await app.inject({ method: 'GET', url: `/report-cards/jobs/${jobs[MINE]}` });
    expect(status.statusCode).toBe(403);
    const comments = await app.inject({
      method: 'GET',
      url: `/report-cards/comments?studentId=${MINE}&academicPeriodId=${PERIOD}`,
    });
    expect(comments.statusCode).toBe(403);
  });

  it('a portal principal with no binding gets 404, not the PDF', async () => {
    user = { sub: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', roles: ['student'] };
    expect((await download(MINE)).statusCode).toBe(404);
  });
});
