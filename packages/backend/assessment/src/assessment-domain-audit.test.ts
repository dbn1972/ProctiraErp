/**
 * PRC-M495 (failing-first, audit): assessment score writes (with before/after values),
 * grading-scheme and assessment-item changes, report-card generation and report-card
 * downloads each emit one domain audit entry through the injected `auditSink`, carrying
 * tenantId, actorId, entityType, entityId and action. Without a sink, behaviour is unchanged.
 */
import Fastify from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AssessmentAuditEntry } from './assessment-audit.js';
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
import { InMemoryReportCardArtifactStore } from './report-card-artifact-store.js';
import { ReportCardService } from './report-card-service.js';
import { anyIdReportCardDirectory } from './report-card-test-directory.js';
import { ResultService } from './result-service.js';
import { registerAssessmentRoutes } from './routes.js';

const TENANT = uuidv4();
const ACTOR = { actorId: uuidv4() };
const SUBJECT = uuidv4();
const PERIOD = uuidv4();
const STUDENT = uuidv4();
const INSTITUTION = uuidv4();

const thresholds = [
  { grade: 'F', minScore: 0, maxScore: 49.99 },
  { grade: 'P', minScore: 50, maxScore: 100 },
];

describe('PRC-M495 assessment domain audit', () => {
  let entries: AssessmentAuditEntry[];
  let schemes: InMemoryGradingSchemeRepository;
  let items: InMemoryAssessmentItemRepository;
  let results: InMemoryAssessmentResultRepository;
  let jobs: InMemoryReportCardJobRepository;
  let templates: InMemoryReportCardTemplateRepository;
  let artifacts: InMemoryReportCardArtifactStore;
  let assessment: AssessmentService;
  let resultService: ResultService;
  let reportCards: ReportCardService;

  beforeEach(() => {
    entries = [];
    const auditSink = async (entry: AssessmentAuditEntry) => {
      entries.push(entry);
    };
    schemes = new InMemoryGradingSchemeRepository();
    items = new InMemoryAssessmentItemRepository();
    results = new InMemoryAssessmentResultRepository();
    jobs = new InMemoryReportCardJobRepository();
    templates = new InMemoryReportCardTemplateRepository();
    artifacts = new InMemoryReportCardArtifactStore();
    assessment = new AssessmentService(schemes, items, new InMemoryOutcomeRepository(), results, {
      auditSink,
    });
    resultService = new ResultService(results, items, schemes, { auditSink });
    reportCards = new ReportCardService(
      templates,
      new InMemoryTeacherCommentRepository(),
      new InMemoryInstitutionBrandingRepository(),
      jobs,
      resultService,
      items,
      { publish: async () => undefined },
      null,
      { directory: anyIdReportCardDirectory, artifactStore: artifacts, auditSink },
    );
  });

  function only(action: string): AssessmentAuditEntry {
    const matching = entries.filter((e) => e.action === action);
    expect(matching, `audit entries for ${action}`).toHaveLength(1);
    const entry = matching[0]!;
    expect(entry.tenantId).toBe(TENANT);
    expect(entry.actorId).toBe(ACTOR.actorId);
    expect(entry.entityType).toBeTruthy();
    expect(entry.entityId).toBeTruthy();
    return entry;
  }

  async function schemeAndItem() {
    const scheme = await assessment.createGradingScheme(
      TENANT,
      { name: 'Pass/Fail', type: 'numeric', minValue: 0, maxValue: 100, thresholds },
      ACTOR,
    );
    const [item] = await assessment.defineAssessmentItems(
      TENANT,
      {
        subjectId: SUBJECT,
        academicPeriodId: PERIOD,
        gradingSchemeId: scheme.id,
        items: [{ name: 'Final', weight: 100, minScore: 0, maxScore: 100 }],
      },
      ACTOR,
    );
    return { scheme, item: item! };
  }

  it('audits grading-scheme create, update and delete', async () => {
    const scheme = await assessment.createGradingScheme(
      TENANT,
      { name: 'Scheme A', type: 'numeric', minValue: 0, maxValue: 100, thresholds },
      ACTOR,
    );
    await assessment.updateGradingScheme(TENANT, scheme.id, { name: 'Scheme B' }, ACTOR);
    await assessment.deleteGradingScheme(TENANT, scheme.id, ACTOR);
    expect(only('grading_scheme.create').entityId).toBe(scheme.id);
    const updated = only('grading_scheme.update');
    expect(updated.before).toMatchObject({ name: 'Scheme A' });
    expect(updated.after).toMatchObject({ name: 'Scheme B' });
    expect(only('grading_scheme.delete').operation).toBe('DELETE');
  });

  it('audits assessment-item definition with before/after item lists', async () => {
    const { item } = await schemeAndItem();
    const define = only('assessment_items.define');
    expect(define.before).toMatchObject({ items: [] });
    expect(define.after).toMatchObject({ items: [{ id: item.id, name: 'Final', weight: 100 }] });
  });

  it('audits a single score write with before/after score', async () => {
    const { item } = await schemeAndItem();
    const input = {
      studentId: STUDENT,
      assessmentItemId: item.id,
      subjectId: SUBJECT,
      academicPeriodId: PERIOD,
    };
    await resultService.enterSingleResult(TENANT, { ...input, score: 40 }, ACTOR);
    await resultService.enterSingleResult(TENANT, { ...input, score: 72 }, ACTOR);
    const writes = entries.filter((e) => e.action === 'result.enter');
    expect(writes).toHaveLength(2);
    expect(writes[0]!.before).toMatchObject({ score: null });
    expect(writes[0]!.after).toMatchObject({ score: 40 });
    expect(writes[1]!.before).toMatchObject({ score: 40 });
    expect(writes[1]!.after).toMatchObject({ score: 72 });
    expect(writes.every((w) => w.actorId === ACTOR.actorId && w.tenantId === TENANT)).toBe(true);
  });

  it('audits a bulk score write once, with per-row before/after', async () => {
    const { item } = await schemeAndItem();
    await resultService.enterSingleResult(
      TENANT,
      {
        studentId: STUDENT,
        assessmentItemId: item.id,
        subjectId: SUBJECT,
        academicPeriodId: PERIOD,
        score: 30,
      },
      ACTOR,
    );
    const other = uuidv4();
    await resultService.enterBulkResults(
      TENANT,
      {
        subjectId: SUBJECT,
        academicPeriodId: PERIOD,
        results: [
          { studentId: STUDENT, assessmentItemId: item.id, score: 55 },
          { studentId: other, assessmentItemId: item.id, score: 90 },
        ],
      },
      ACTOR,
    );
    const bulk = only('result.bulk_enter');
    const rows = (bulk.after as { rows: Array<Record<string, unknown>> }).rows;
    expect(rows).toEqual(
      expect.arrayContaining([
        { studentId: STUDENT, assessmentItemId: item.id, before: 30, after: 55 },
        { studentId: other, assessmentItemId: item.id, before: null, after: 90 },
      ]),
    );
  });

  it('audits report-card generation and download', async () => {
    const template = await reportCards.createTemplate(TENANT, {
      name: 'Standard',
      templateContent: '<html></html>',
      isDefault: true,
    });
    const job = await reportCards.queueReportCardGeneration(
      TENANT,
      {
        studentId: STUDENT,
        academicPeriodId: PERIOD,
        templateId: template.id,
        institutionId: INSTITUTION,
      },
      ACTOR,
    );
    const generate = only('report_card.generate');
    expect(generate.entityId).toBe(job.id);

    const done = await jobs.create({
      id: uuidv4(),
      tenantId: TENANT,
      studentId: STUDENT,
      academicPeriodId: PERIOD,
      templateId: template.id,
      institutionId: INSTITUTION,
      status: 'completed',
      errorMessage: null,
      outputUrl: `report-cards/${TENANT}/done.pdf`,
    });
    await artifacts.put(`report-cards/${TENANT}/done.pdf`, Buffer.from('%PDF-1.4'));
    await reportCards.getReportCardPdf(TENANT, done.id, ACTOR);
    const download = only('report_card.download');
    expect(download.entityId).toBe(done.id);
    expect(download.operation).toBe('CREATE');
    expect(download.metadata).toMatchObject({ read: true, studentId: STUDENT });
  });

  it('routes record the JWT subject as the audit actor', async () => {
    const app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId: string }).tenantId = TENANT;
      (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
        sub: ACTOR.actorId,
        roles: ['admin'],
      };
    });
    await registerAssessmentRoutes(app, { assessmentService: assessment });
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/grading-schemes',
        payload: { name: 'Via route', type: 'numeric', minValue: 0, maxValue: 100, thresholds },
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(only('grading_scheme.create').entityId).toBe((res.json() as { id: string }).id);
    } finally {
      await app.close();
    }
  });

  it('audits bulk report-card generation once with the job ids', async () => {
    const template = await reportCards.createTemplate(TENANT, {
      name: 'Bulk',
      templateContent: '<html></html>',
      isDefault: true,
    });
    const result = await reportCards.queueBulkReportCardGeneration(
      TENANT,
      {
        studentIds: [uuidv4(), uuidv4()],
        academicPeriodId: PERIOD,
        templateId: template.id,
        institutionId: INSTITUTION,
      },
      ACTOR,
    );
    const bulk = only('report_card.bulk_generate');
    expect(bulk.metadata).toMatchObject({ jobIds: result.jobs.map((j) => j.id) });
  });
});
