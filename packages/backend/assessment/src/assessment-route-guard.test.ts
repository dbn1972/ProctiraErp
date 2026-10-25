/**
 * PRC-L083: the assessment RBAC preHandler is installed once per Fastify
 * instance, even when the grading, result and report-card route groups share
 * that instance (as they do under the fastify-plugin wrapped assessmentPlugin).
 * Every group still denies forbidden roles.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const accessCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('./assessment-access.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./assessment-access.js')>();
  return {
    ...actual,
    assertAssessmentAccess: (...args: Parameters<typeof actual.assertAssessmentAccess>) => {
      accessCalls.count += 1;
      return actual.assertAssessmentAccess(...args);
    },
  };
});

import { AssessmentService } from './assessment-service.js';
import {
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
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

describe('PRC-L083: assessment route guard installed once per instance', () => {
  let app: FastifyInstance;
  let roles: string[];
  const tenantId = uuidv4();

  beforeEach(async () => {
    roles = ['teacher'];
    app = Fastify();
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantId;
      (request as unknown as { user: { sub: string; roles: string[] } }).user = {
        sub: uuidv4(),
        roles,
      };
    });

    const gradingSchemeRepo = new InMemoryGradingSchemeRepository();
    const itemRepo = new InMemoryAssessmentItemRepository();
    const resultRepo = new InMemoryAssessmentResultRepository();
    const assessmentService = new AssessmentService(
      gradingSchemeRepo,
      itemRepo,
      new InMemoryOutcomeRepository(),
      resultRepo,
    );
    const resultService = new ResultService(resultRepo, itemRepo, gradingSchemeRepo);
    const reportCardService = new ReportCardService(
      new InMemoryReportCardTemplateRepository(),
      new InMemoryTeacherCommentRepository(),
      new InMemoryInstitutionBrandingRepository(),
      new InMemoryReportCardJobRepository(),
      resultService,
      itemRepo,
      null,
      { generateReportCardPdf: async () => Buffer.from('pdf') },
    );

    // Same instance for all three groups, mirroring assessmentPlugin (fp-wrapped).
    await registerAssessmentRoutes(app, { assessmentService });
    await registerResultRoutes(app, { resultService });
    await registerReportCardRoutes(app, { reportCardService });
    await app.ready();
    accessCalls.count = 0;
  });

  afterEach(async () => {
    await app.close();
  });

  it('runs the RBAC check exactly once per request', async () => {
    const res = await app.inject({ method: 'GET', url: '/grading-schemes' });
    expect(res.statusCode).toBe(200);
    expect(accessCalls.count).toBe(1);
  });

  it.each([
    ['GET', '/grading-schemes'],
    ['GET', `/results/grades?subjectId=${uuidv4()}&academicPeriodId=${uuidv4()}`],
    ['GET', '/report-cards/templates'],
    ['POST', '/report-cards/templates'],
  ] as const)('still denies a forbidden role on %s %s', async (method, url) => {
    roles = ['parent'];
    const res = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
    expect(res.statusCode).toBe(403);
    expect(accessCalls.count).toBe(1);
  });
});
