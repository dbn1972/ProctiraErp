/**
 * PRC-M160: teacher -> subject ownership, read vs write vs configure.
 *
 * A teacher-only caller writes items / results / comments only for subjects it
 * teaches; grading schemes, report-card templates and outcome deletes are
 * coordinator configuration; the registrar reads but does not author marks.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertAssessmentOwnership, type AssessmentTeachingScope } from './assessment-ownership.js';
import { AssessmentService } from './assessment-service.js';
import {
  InMemoryReportCardJobRepository,
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
} from './in-memory-report-card-repository.js';
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import { registerReportCardRoutes } from './report-card-routes.js';
import { ReportCardService } from './report-card-service.js';
import { registerResultRoutes } from './result-routes.js';
import { ResultService } from './result-service.js';
import { registerAssessmentRoutes } from './routes.js';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEACHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MATHS = '11111111-1111-4111-8111-111111111111';
const HISTORY = '44444444-4444-4444-8444-444444444444';
const PERIOD = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333-3333-4333-8333-333333333333';

/** The teacher teaches maths only. */
const scope: AssessmentTeachingScope = {
  teachesSubject: async (_t, principals, subjectId) =>
    principals.includes(TEACHER) && subjectId === MATHS,
  teachesStudent: async (_t, principals, studentId) =>
    principals.includes(TEACHER) && studentId === STUDENT,
};

const SCHEME = {
  name: 'Scale',
  type: 'numeric',
  minValue: 0,
  maxValue: 100,
  thresholds: [
    { grade: 'A', minScore: 50, maxScore: 100 },
    { grade: 'F', minScore: 0, maxScore: 49 },
  ],
};

describe('assessment ownership and action split (PRC-M160)', () => {
  let app: FastifyInstance;
  let service: AssessmentService;
  let roles: unknown[] = ['teacher'];
  let mathsItemId = '';
  let historyItemId = '';
  let schemeId = '';

  beforeEach(async () => {
    const schemes = new InMemoryGradingSchemeRepository();
    const items = new InMemoryAssessmentItemRepository();
    const outcomes = new InMemoryOutcomeRepository();
    service = new AssessmentService(schemes, items, outcomes);
    const resultService = new ResultService(
      new InMemoryAssessmentResultRepository(),
      items,
      schemes,
    );
    const reportCardService = new ReportCardService(
      new InMemoryReportCardTemplateRepository(),
      new InMemoryTeacherCommentRepository(),
      new InMemoryInstitutionBrandingRepository(),
      new InMemoryReportCardJobRepository(),
      resultService,
      items,
      { publish: async () => {} },
      { generateReportCardPdf: async () => Buffer.from('pdf') },
    );
    app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      (request as unknown as { user: unknown }).user = { sub: TEACHER, roles };
    });
    await registerAssessmentRoutes(app, { assessmentService: service, teachingScope: scope });
    await registerResultRoutes(app, { resultService, teachingScope: scope });
    await registerReportCardRoutes(app, { reportCardService, teachingScope: scope });
    await app.ready();
    const scheme = await service.createGradingScheme(TENANT, SCHEME as never);
    schemeId = scheme.id;
    const define = (subjectId: string) =>
      service.defineAssessmentItems(TENANT, {
        subjectId,
        academicPeriodId: PERIOD,
        gradingSchemeId: scheme.id,
        items: [{ name: 'Final', weight: 100, minScore: 0, maxScore: 100 }],
      });
    mathsItemId = (await define(MATHS))[0]!.id;
    historyItemId = (await define(HISTORY))[0]!.id;
    roles = ['teacher'];
  });

  afterEach(async () => {
    await app.close();
  });

  const result = (subjectId: string, itemId: string) => ({
    subjectId,
    academicPeriodId: PERIOD,
    studentId: STUDENT,
    assessmentItemId: itemId,
    score: 70,
  });

  it('a teacher enters results only for the subject they teach', async () => {
    const other = await app.inject({
      method: 'POST',
      url: '/results',
      payload: result(HISTORY, historyItemId),
    });
    expect(other.statusCode).toBe(403);
    const own = await app.inject({
      method: 'POST',
      url: '/results',
      payload: result(MATHS, mathsItemId),
    });
    expect(own.statusCode).toBe(201);
  });

  it('bulk entry and import for another subject are refused', async () => {
    const bulk = await app.inject({
      method: 'POST',
      url: '/results/bulk',
      payload: {
        subjectId: HISTORY,
        academicPeriodId: PERIOD,
        results: [{ studentId: STUDENT, assessmentItemId: historyItemId, score: 60 }],
      },
    });
    expect(bulk.statusCode).toBe(403);
    const imported = await app.inject({
      method: 'POST',
      url: '/results/import',
      payload: {
        subjectId: HISTORY,
        academicPeriodId: PERIOD,
        rows: [{ studentId: STUDENT, assessmentItemId: historyItemId, score: 60 }],
      },
    });
    expect(imported.statusCode).toBe(403);
  });

  it('a teacher defines items and outcomes only for their subject', async () => {
    const items = await app.inject({
      method: 'POST',
      url: '/assessment-items',
      payload: {
        subjectId: HISTORY,
        academicPeriodId: PERIOD,
        gradingSchemeId: schemeId,
        items: [{ name: 'Test', weight: 100, minScore: 0, maxScore: 100 }],
      },
    });
    expect(items.statusCode).toBe(403);
    const outcome = await app.inject({
      method: 'POST',
      url: '/outcomes',
      payload: { name: 'Dates', code: 'H1', subjectId: HISTORY },
    });
    expect(outcome.statusCode).toBe(403);
  });

  it('a teacher comments only on a subject they teach', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/report-cards/comments',
      payload: {
        studentId: STUDENT,
        subjectId: HISTORY,
        academicPeriodId: PERIOD,
        comment: 'Good',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('grading schemes and templates are coordinator configuration, not teacher work', async () => {
    const scheme = await app.inject({ method: 'POST', url: '/grading-schemes', payload: SCHEME });
    expect(scheme.statusCode).toBe(403);
    const template = await app.inject({
      method: 'POST',
      url: '/report-cards/templates',
      payload: { name: 'T', templateContent: '<p/>' },
    });
    expect(template.statusCode).toBe(403);
    roles = ['academic_coordinator'];
    const allowed = await app.inject({
      method: 'POST',
      url: '/grading-schemes',
      payload: { ...SCHEME, name: 'Scale 2' },
    });
    expect(allowed.statusCode).toBe(201);
  });

  it('the registrar reads assessment data but does not author marks', async () => {
    roles = ['registrar'];
    const write = await app.inject({
      method: 'POST',
      url: '/results',
      payload: result(MATHS, mathsItemId),
    });
    expect(write.statusCode).toBe(403);
    const read = await app.inject({
      method: 'GET',
      url: `/assessment-items?subjectId=${MATHS}&academicPeriodId=${PERIOD}`,
    });
    expect(read.statusCode).toBe(200);
  });

  it('a roleName of "Principal" on a teacher roleId does not lift the subject check', async () => {
    roles = [{ roleId: 'teacher', roleName: 'principal' }];
    const res = await app.inject({
      method: 'POST',
      url: '/results',
      payload: result(HISTORY, historyItemId),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('assertAssessmentOwnership without a scope (PRC-M160)', () => {
  it('fails closed in production-like environments', async () => {
    await expect(
      assertAssessmentOwnership(
        { sub: TEACHER, roles: ['teacher'] },
        TENANT,
        null,
        { subjectIds: [MATHS] },
        'production',
      ),
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it('institution-wide roles are not looked up', async () => {
    await expect(
      assertAssessmentOwnership(
        { sub: TEACHER, roles: ['principal'] },
        TENANT,
        null,
        { subjectIds: [MATHS] },
        'production',
      ),
    ).resolves.toBeUndefined();
  });
});
