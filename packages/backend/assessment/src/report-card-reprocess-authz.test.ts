/**
 * PRC-L080 — POST /report-cards/jobs/:jobId/process is an operator surface.
 * A plain teacher (assessment.write) must be denied; an admin/exam officer is allowed.
 */
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
} from './in-memory-report-card-repository.js';
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import { registerReportCardRoutes } from './report-card-routes.js';
import { ReportCardService } from './report-card-service.js';
import type { TaskQueuePublisher, PdfGenerator } from './report-card-service.js';
import { ResultService } from './result-service.js';

const TENANT = uuidv4();
const USER = '9f3c2b1a-0d4e-4f5a-8b6c-7d8e9f0a1b2c';

function buildApp(roles: string[]): FastifyInstance {
  const app = Fastify();
  const jobRepo = new InMemoryReportCardJobRepository();
  const resultService = new ResultService(
    new InMemoryAssessmentResultRepository(),
    new InMemoryAssessmentItemRepository(),
    new InMemoryGradingSchemeRepository(),
  );
  const publisher: TaskQueuePublisher = { async publish() {} };
  const pdf: PdfGenerator = {
    async generateReportCardPdf() {
      return Buffer.from('pdf');
    },
  };
  const service = new ReportCardService(
    new InMemoryReportCardTemplateRepository(),
    new InMemoryTeacherCommentRepository(),
    new InMemoryInstitutionBrandingRepository(),
    jobRepo,
    resultService,
    new InMemoryAssessmentItemRepository(),
    publisher,
    pdf,
  );
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    (request as unknown as { tenantId: string }).tenantId = TENANT;
    (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
      sub: USER,
      roles,
    };
  });
  // registerReportCardRoutes returns a promise; caller awaits via ready().
  void registerReportCardRoutes(app, { reportCardService: service });
  return app;
}

describe('PRC-L080 report-card job reprocess authz', () => {
  let teacherApp: FastifyInstance;
  let adminApp: FastifyInstance;

  beforeEach(async () => {
    teacherApp = buildApp(['teacher']);
    adminApp = buildApp(['exam_officer']);
    await teacherApp.ready();
    await adminApp.ready();
  });

  it('denies a plain teacher with 403', async () => {
    const res = await teacherApp.inject({
      method: 'POST',
      url: `/report-cards/jobs/${uuidv4()}/process`,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('allows an exam officer past the role gate (404 for an unknown job, not 403)', async () => {
    const res = await adminApp.inject({
      method: 'POST',
      url: `/report-cards/jobs/${uuidv4()}/process`,
    });
    expect(res.statusCode).not.toBe(403);
  });
});
