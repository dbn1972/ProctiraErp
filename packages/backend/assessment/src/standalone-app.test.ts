/**
 * PRC-M167 — one PrismaClient per process for the assessment factories, and the
 * standalone server authenticates every domain request.
 */
import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

const createPrismaClient = vi.fn((opts: { datasourceUrl?: string }) => ({
  __client: opts.datasourceUrl,
}));

vi.mock('@proctira/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/database')>();
  return { ...actual, createPrismaClient: (o: { datasourceUrl?: string }) => createPrismaClient(o) };
});

const {
  createAssessmentItemRepository,
  createAssessmentResultRepository,
  createGradingSchemeRepository,
  createOutcomeRepository,
  resetAssessmentPrismaClientCacheForTests,
} = await import('./repository-factory.js');
const { buildStandaloneAssessmentApp } = await import('./standalone-app.js');
const {
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
} = await import('./in-memory-report-card-repository.js');
const {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
  InMemoryOutcomeRepository,
} = await import('./in-memory-repository.js');
const { InMemoryAssessmentResultRepository } = await import('./in-memory-result-repository.js');

const SECRET = 'x'.repeat(40);
const TENANT = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

function sign(claims: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'HS256', typ: 'JWT' });
  const body = enc(claims);
  const sig = createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

describe('assessment repository factories (PRC-M167)', () => {
  afterEach(() => {
    resetAssessmentPrismaClientCacheForTests();
    createPrismaClient.mockClear();
  });

  it('share one PrismaClient per database URL across all factories', () => {
    const config = { databaseUrl: 'postgresql://u:p@localhost:5432/one' };
    createGradingSchemeRepository(config);
    createAssessmentItemRepository(config);
    createOutcomeRepository(config);
    createAssessmentResultRepository(config);
    expect(createPrismaClient).toHaveBeenCalledTimes(1);
    createGradingSchemeRepository({ databaseUrl: 'postgresql://u:p@localhost:5432/two' });
    expect(createPrismaClient).toHaveBeenCalledTimes(2);
  });
});

describe('standalone assessment app (PRC-M167)', () => {
  async function build() {
    return buildStandaloneAssessmentApp({
      jwt: { secret: SECRET },
      repositories: {
        gradingSchemeRepository: new InMemoryGradingSchemeRepository(),
        assessmentItemRepository: new InMemoryAssessmentItemRepository(),
        outcomeRepository: new InMemoryOutcomeRepository(),
        resultRepository: new InMemoryAssessmentResultRepository(),
        reportCardTemplateRepository: new InMemoryReportCardTemplateRepository(),
        teacherCommentRepository: new InMemoryTeacherCommentRepository(),
        institutionBrandingRepository: new InMemoryInstitutionBrandingRepository(),
        reportCardJobRepository: new InMemoryReportCardJobRepository(),
      },
      pluginOptions: { reportCardDirectory: null },
    });
  }

  it('refuses to start without a strong JWT secret', async () => {
    await expect(buildStandaloneAssessmentApp({ jwt: { secret: '' } })).rejects.toThrow(
      /JWT_SECRET/,
    );
  });

  it('rejects unauthenticated domain requests and serves authenticated ones', async () => {
    const app = await build();
    try {
      const anon = await app.inject({ method: 'GET', url: '/assessments/grading-schemes' });
      expect(anon.statusCode).toBe(401);

      const token = sign({
        sub: 'b3f1c1de-2f4a-4c55-9d3e-1a2b3c4d5e6f',
        tenantId: TENANT,
        roles: ['teacher'],
        exp: Math.floor(Date.now() / 1000) + 600,
      });
      const ok = await app.inject({
        method: 'GET',
        url: '/assessments/grading-schemes',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(ok.statusCode).toBe(200);

      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
