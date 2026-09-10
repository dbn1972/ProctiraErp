/**
 * G-210 — report-card repository factories enable assessment routes.
 */
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { v4 as uuidv4 } from 'uuid';

import { assessmentPlugin } from './assessment-plugin.js';
import {
  createAssessmentItemRepository,
  createAssessmentResultRepository,
  createGradingSchemeRepository,
  createInstitutionBrandingRepository,
  createOutcomeRepository,
  createReportCardJobRepository,
  createReportCardTemplateRepository,
  createTeacherCommentRepository,
} from './repository-factory.js';

describe('report-card repository factories (G-210)', () => {
  it('wires report-card routes when factories are composed into assessmentPlugin', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as { tenantId?: string }).tenantId = uuidv4();
    });

    await app.register(assessmentPlugin, {
      gradingSchemeRepository: createGradingSchemeRepository({ databaseUrl: undefined }),
      assessmentItemRepository: createAssessmentItemRepository({ databaseUrl: undefined }),
      outcomeRepository: createOutcomeRepository({ databaseUrl: undefined }),
      resultRepository: createAssessmentResultRepository({ databaseUrl: undefined }),
      reportCardTemplateRepository: createReportCardTemplateRepository(),
      teacherCommentRepository: createTeacherCommentRepository(),
      institutionBrandingRepository: createInstitutionBrandingRepository(),
      reportCardJobRepository: createReportCardJobRepository(),
    });
    await app.ready();

    expect(app.reportCardService).toBeDefined();

    const list = await app.inject({ method: 'GET', url: '/report-cards/templates' });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { data?: unknown[] } | unknown[];
    // Route responds (empty list is fine — proves registration).
    expect(list.statusCode).not.toBe(404);

    const create = await app.inject({
      method: 'POST',
      url: '/report-cards/templates',
      payload: {
        name: 'Default term card',
        templateContent: '<h1>{{student.name}}</h1>',
        isDefault: true,
        includeLogo: true,
        includeGradeSummary: true,
        includeComments: true,
      },
    });
    expect([200, 201]).toContain(create.statusCode);

    await app.close();
    void body;
  });
});
