/**
 * G-716: report cards are real PDFs, stored and downloadable.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { inspectPdf, isPdfBuffer } from '@proctira/pdf-lite';
import { v4 as uuidv4 } from 'uuid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
import {
  FilesystemReportCardArtifactStore,
  InMemoryReportCardArtifactStore,
} from './report-card-artifact-store.js';
import { ReportCardPdfGenerator, templateHeading } from './report-card-pdf-generator.js';
import { AssessmentService } from './assessment-service.js';
import { InMemoryOutcomeRepository } from './in-memory-repository.js';
import { registerReportCardRoutes } from './report-card-routes.js';
import { ReportCardService, type ReportCardData } from './report-card-service.js';
import { ResultService } from './result-service.js';

const sampleData = (): ReportCardData => ({
  student: { id: 'stu-1', name: 'Ada Lovelace' },
  institution: { name: 'Analytical Engine Academy', logoUrl: null, address: '1 Babbage Way' },
  academicPeriodId: 'term-1',
  subjects: [
    {
      subjectId: 'sub-math',
      subjectName: 'Mathematics',
      items: [
        { name: 'Midterm', score: 45, maxScore: 50, weight: 0.4, weightedScore: 36 },
        { name: 'Final', score: 92, maxScore: 100, weight: 0.6, weightedScore: 55.2 },
      ],
      weightedAverage: 91.2,
      grade: 'A',
      gradeDescriptor: 'Excellent',
      teacherComment: 'Outstanding analytical (and creative) work.',
    },
    {
      subjectId: 'sub-hist',
      subjectName: 'History',
      items: [],
      weightedAverage: 78,
      grade: 'B',
      gradeDescriptor: null,
      teacherComment: null,
    },
  ],
  overallGradeSummary: { averageScore: 84.6, totalSubjects: 2, grade: 'A-' },
  generatedAt: '2026-09-08T10:00:00.000Z',
});

describe('ReportCardPdfGenerator', () => {
  it('renders a real PDF containing the report-card content', async () => {
    const bytes = await new ReportCardPdfGenerator().generateReportCardPdf(
      '<html><head><title>Term Report</title></head><body>{{studentName}}</body></html>',
      sampleData(),
    );
    expect(isPdfBuffer(bytes)).toBe(true);
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');

    const info = inspectPdf(bytes);
    expect(info.pageCount).toBeGreaterThanOrEqual(1);
    expect(info.startXrefValid).toBe(true);
    for (const expected of [
      'Term Report',
      'Analytical Engine Academy',
      'Ada Lovelace',
      'Mathematics',
      'Midterm',
      'Final',
      'History',
      'Teacher comment: Outstanding analytical (and creative) work.',
      'Overall grade',
      'A-',
    ]) {
      expect(info.literalStrings).toContain(expected);
    }
  });

  it('derives a heading from the template and falls back sensibly', () => {
    expect(templateHeading('<html><head><title>Term Report</title></head></html>')).toBe(
      'Term Report',
    );
    expect(templateHeading('<h1>Progress Card</h1>')).toBe('Progress Card');
    expect(templateHeading('<html><body>{{studentName}}</body></html>')).toBe('Report Card');
    expect(templateHeading('Mid-year summary')).toBe('Mid-year summary');
  });
});

describe('FilesystemReportCardArtifactStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rc-store-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('round-trips bytes and returns null for unknown keys', async () => {
    const store = new FilesystemReportCardArtifactStore(dir);
    await store.put('report-cards/t1/s1/p1/j1.pdf', Buffer.from('%PDF-1.4 x'));
    expect((await store.get('report-cards/t1/s1/p1/j1.pdf'))?.toString()).toBe('%PDF-1.4 x');
    expect(await store.get('report-cards/t1/s1/p1/missing.pdf')).toBeNull();
  });

  it('rejects keys that escape the storage root', async () => {
    const store = new FilesystemReportCardArtifactStore(dir);
    await expect(store.put('../escape.pdf', Buffer.from('x'))).rejects.toThrow(
      /escapes storage root/,
    );
    await expect(store.get('/etc/passwd')).resolves.toBeNull();
  });
});

describe('report-card routes — generate → download real PDF (G-716)', () => {
  let app: FastifyInstance;
  let artifactStore: InMemoryReportCardArtifactStore;
  const tenantId = uuidv4();

  async function build(processInline: boolean): Promise<void> {
    app = Fastify();
    const templateRepo = new InMemoryReportCardTemplateRepository();
    const jobRepo = new InMemoryReportCardJobRepository();
    const itemRepo = new InMemoryAssessmentItemRepository();
    const resultService = new ResultService(
      new InMemoryAssessmentResultRepository(),
      itemRepo,
      new InMemoryGradingSchemeRepository(),
    );
    artifactStore = new InMemoryReportCardArtifactStore();
    const service = new ReportCardService(
      templateRepo,
      new InMemoryTeacherCommentRepository(),
      new InMemoryInstitutionBrandingRepository(),
      jobRepo,
      resultService,
      itemRepo,
      null,
      new ReportCardPdfGenerator(),
      { artifactStore, processInline },
    );
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = tenantId;
    });
    await registerReportCardRoutes(app, { reportCardService: service });
    await app.ready();
  }

  afterEach(async () => {
    await app.close();
  });

  async function createTemplate(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/report-cards/templates',
      payload: {
        name: 'Default',
        templateContent: '<title>Term 1 Report</title>',
        isDefault: true,
      },
    });
    return (res.json() as { id: string }).id;
  }

  it('completes inline without a queue and serves %PDF bytes on download', async () => {
    await build(true);
    const templateId = await createTemplate();
    const studentId = uuidv4();

    const gen = await app.inject({
      method: 'POST',
      url: '/report-cards/generate',
      payload: { studentId, academicPeriodId: uuidv4(), templateId, institutionId: uuidv4() },
    });
    expect(gen.statusCode).toBe(202);
    const job = gen.json() as { id: string; status: string; outputUrl: string | null };
    expect(job.status).toBe('completed');
    expect(job.outputUrl).toMatch(new RegExp(`^report-cards/${tenantId}/${studentId}/`));
    expect(artifactStore.size).toBe(1);

    const download = await app.inject({
      method: 'GET',
      url: `/report-cards/jobs/${job.id}/download`,
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['content-disposition']).toContain('.pdf');
    const bytes = download.rawPayload;
    expect(bytes.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    const info = inspectPdf(bytes);
    expect(info.pageCount).toBe(1);
    expect(info.hasEof).toBe(true);
    expect(info.literalStrings).toContain('Term 1 Report');
    expect(info.literalStrings).toContain(studentId);
  });

  it('keeps jobs queued when inline processing is off, then processes on demand', async () => {
    await build(false);
    const templateId = await createTemplate();
    const gen = await app.inject({
      method: 'POST',
      url: '/report-cards/generate',
      payload: {
        studentId: uuidv4(),
        academicPeriodId: uuidv4(),
        templateId,
        institutionId: uuidv4(),
      },
    });
    const job = gen.json() as { id: string; status: string };
    expect(job.status).toBe('queued');

    const early = await app.inject({ method: 'GET', url: `/report-cards/jobs/${job.id}/download` });
    expect(early.statusCode).toBe(422);

    const processed = await app.inject({
      method: 'POST',
      url: `/report-cards/jobs/${job.id}/process`,
    });
    expect(processed.statusCode).toBe(200);
    expect((processed.json() as { status: string }).status).toBe('completed');

    const download = await app.inject({
      method: 'GET',
      url: `/report-cards/jobs/${job.id}/download`,
    });
    expect(download.statusCode).toBe(200);
    expect(isPdfBuffer(download.rawPayload)).toBe(true);
  });

  it('404s for unknown jobs', async () => {
    await build(true);
    const res = await app.inject({ method: 'GET', url: `/report-cards/jobs/${uuidv4()}/download` });
    expect(res.statusCode).toBe(404);
  });
});

describe('report cards include every graded subject for the student (G-716)', () => {
  it('assembles subjects from stored results and renders item names + max scores', async () => {
    const tenantId = uuidv4();
    const studentId = uuidv4();
    const academicPeriodId = uuidv4();
    const mathId = uuidv4();
    const physicsId = uuidv4();

    const itemRepo = new InMemoryAssessmentItemRepository();
    const schemeRepo = new InMemoryGradingSchemeRepository();
    const resultRepo = new InMemoryAssessmentResultRepository();
    const assessmentService = new AssessmentService(
      schemeRepo,
      itemRepo,
      new InMemoryOutcomeRepository(),
    );
    const resultService = new ResultService(resultRepo, itemRepo, schemeRepo);

    const scheme = await assessmentService.createGradingScheme(tenantId, {
      name: 'Pct',
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [
        { grade: 'A', minScore: 90, maxScore: 100 },
        { grade: 'B', minScore: 80, maxScore: 89 },
        { grade: 'C', minScore: 0, maxScore: 79 },
      ],
    });
    for (const subjectId of [mathId, physicsId]) {
      const items = await assessmentService.defineAssessmentItems(tenantId, {
        subjectId,
        academicPeriodId,
        gradingSchemeId: scheme.id,
        items: [
          { name: `Midterm-${subjectId.slice(0, 4)}`, weight: 40, minScore: 0, maxScore: 50 },
          { name: `Final-${subjectId.slice(0, 4)}`, weight: 60, minScore: 0, maxScore: 100 },
        ],
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[0]!.id,
        score: 45,
      });
      await resultService.enterSingleResult(tenantId, {
        subjectId,
        academicPeriodId,
        studentId,
        assessmentItemId: items[1]!.id,
        score: subjectId === mathId ? 95 : 70,
      });
    }

    const templateRepo = new InMemoryReportCardTemplateRepository();
    const template = await templateRepo.create({
      id: uuidv4(),
      tenantId,
      name: 'T',
      templateContent: '<title>Full Card</title>',
      isDefault: true,
      includeLogo: false,
      includeComments: true,
    } as never);
    const artifactStore = new InMemoryReportCardArtifactStore();
    const service = new ReportCardService(
      templateRepo,
      new InMemoryTeacherCommentRepository(),
      new InMemoryInstitutionBrandingRepository(),
      new InMemoryReportCardJobRepository(),
      resultService,
      itemRepo,
      null,
      new ReportCardPdfGenerator(),
      { artifactStore, processInline: true, resultRepository: resultRepo },
    );

    const job = await service.queueReportCardGeneration(tenantId, {
      studentId,
      academicPeriodId,
      templateId: template.id,
      institutionId: uuidv4(),
    });
    expect(job.status).toBe('completed');

    const pdf = await service.getReportCardPdf(tenantId, job.id);
    const info = inspectPdf(pdf.bytes);
    expect(info.literalStrings).toContain(mathId);
    expect(info.literalStrings).toContain(physicsId);
    expect(info.literalStrings).toContain(`Midterm-${mathId.slice(0, 4)}`);
    expect(info.literalStrings).toContain(`Final-${physicsId.slice(0, 4)}`);
    // maxScore column populated from the assessment item (50 / 100), not 0.
    expect(info.literalStrings).toContain('50');
    expect(info.literalStrings).toContain('100');
    // Overall summary counts both subjects.
    expect(info.literalStrings).toContain('Subjects assessed');
    expect(info.literalStrings).toContain('2');
  });
});
