/**
 * PR B1 (FKB-082) — live proof that report-card jobs resolve `studentId` inside
 * the caller's tenant.
 *
 * Runs as the runtime role (DATABASE_URL = proctira_app, NOSUPERUSER NOBYPASSRLS)
 * through the assessment plugin with the same Postgres repositories the gateway
 * mounts (repository-factory) and no queue publisher (inline processing).
 *
 * Before the fix (RED, origin/main): tenant A's POST /report-cards/generate and
 * /report-cards/generate/bulk with tenant B's studentId answer 202 and persist a
 * job row pointing at B's student; a random id fails with a raw 23503 on
 * `report_card_jobs_student_id_fkey` (500 here, 422 behind the gateway).
 * After (GREEN): 404 NOT_FOUND with identical bodies for another tenant's id and
 * a random id; a bulk request naming one unknown student creates no job at all;
 * same-tenant requests keep 202.
 */
import { randomUUID } from 'node:crypto';
import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assessmentPlugin } from './assessment-plugin.js';
import { InMemoryReportCardArtifactStore } from './report-card-artifact-store.js';
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

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'report-card-tenant-parent.live.test' });

type Res = { statusCode: number; body: string; json: () => Record<string, unknown> };

describe.skipIf(!DATABASE_URL)('PR B1 report-card tenant-parent integrity (live Postgres)', () => {
  // The shared pool the repository factories use (DATABASE_URL); closed by the process.
  const pool = getSharedPgPool()!;
  let app: FastifyInstance;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const studentA = randomUUID();
  const studentA2 = randomUUID();
  const studentB = randomUUID();
  const institutionId = randomUUID();
  const academicPeriodId = randomUUID();
  let templateId: string;

  async function call(tenantId: string, url: string, payload: Record<string, unknown>) {
    const res = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: { 'x-test-tenant': tenantId },
    });
    return {
      statusCode: res.statusCode,
      body: res.body,
      json: () => res.json() as Record<string, unknown>,
    } satisfies Res;
  }

  async function jobCount(studentId: string): Promise<number> {
    const r = await withPgTenant(pool, tenantA, (client) =>
      client.query(`SELECT count(*)::int AS n FROM report_card_jobs WHERE student_id = $1`, [
        studentId,
      ]),
    );
    return (r as unknown as { rows: Array<{ n: number }> }).rows[0]!.n;
  }

  beforeAll(async () => {
    await ensurePgTestTenant(pool, tenantA);
    await ensurePgTestTenant(pool, tenantB);
    await ensurePgTestStudent(pool, tenantA, studentA);
    await ensurePgTestStudent(pool, tenantA, studentA2);
    await ensurePgTestStudent(pool, tenantB, studentB);
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      const r = request as { tenantId?: string; user?: { sub: string; roles: string[] } };
      r.tenantId = String(request.headers['x-test-tenant'] ?? '');
      r.user = { sub: 'b1-report-card-live', roles: ['admin'] };
    });
    await app.register(assessmentPlugin, {
      gradingSchemeRepository: createGradingSchemeRepository(),
      assessmentItemRepository: createAssessmentItemRepository(),
      outcomeRepository: createOutcomeRepository(),
      resultRepository: createAssessmentResultRepository(),
      reportCardTemplateRepository: createReportCardTemplateRepository(),
      teacherCommentRepository: createTeacherCommentRepository(),
      institutionBrandingRepository: createInstitutionBrandingRepository(),
      reportCardJobRepository: createReportCardJobRepository(),
      reportCardArtifactStore: new InMemoryReportCardArtifactStore(),
    });
    await app.ready();
    const tpl = await call(tenantA, '/report-cards/templates', {
      name: `B1 template ${randomUUID().slice(0, 8)}`,
      templateContent: '<p>{{student}}</p>',
    });
    expect(tpl.statusCode, tpl.body).toBe(201);
    templateId = String(tpl.json()['id']);
  });

  afterAll(async () => {
    await app?.close();
  });

  const single = (studentId: string) => ({
    studentId,
    academicPeriodId,
    institutionId,
    templateId,
  });
  const bulk = (studentIds: string[]) => ({
    studentIds,
    academicPeriodId,
    institutionId,
    templateId,
  });

  it("FKB-082 POST /report-cards/generate: own student 202; other tenant's and random 404, identical", async () => {
    const own = await call(tenantA, '/report-cards/generate', single(studentA));
    expect(own.statusCode, own.body).toBe(202);

    const foreign = await call(tenantA, '/report-cards/generate', single(studentB));
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.json()).toEqual({
      code: 'NOT_FOUND',
      statusCode: 404,
      message: `Student with id '${studentB}' not found`,
    });

    const randomId = randomUUID();
    const random = await call(tenantA, '/report-cards/generate', single(randomId));
    expect(random.statusCode, random.body).toBe(404);
    expect(random.body.replaceAll(randomId, '<id>')).toBe(
      foreign.body.replaceAll(studentB, '<id>'),
    );
    expect(await jobCount(studentB)).toBe(0);
  });

  it('FKB-082 POST /report-cards/generate/bulk: own students 202; one other-tenant or random id 404 with no job created', async () => {
    const own = await call(tenantA, '/report-cards/generate/bulk', bulk([studentA2]));
    expect(own.statusCode, own.body).toBe(202);
    expect(own.json()['jobsCreated']).toBe(1);

    const fresh = randomUUID();
    await ensurePgTestStudent(pool, tenantA, fresh);
    const foreign = await call(tenantA, '/report-cards/generate/bulk', bulk([fresh, studentB]));
    expect(foreign.statusCode, foreign.body).toBe(404);
    expect(foreign.json()).toEqual({
      code: 'NOT_FOUND',
      statusCode: 404,
      message: `Student with id '${studentB}' not found`,
    });

    const randomId = randomUUID();
    const random = await call(tenantA, '/report-cards/generate/bulk', bulk([fresh, randomId]));
    expect(random.statusCode, random.body).toBe(404);
    expect(random.body.replaceAll(randomId, '<id>')).toBe(
      foreign.body.replaceAll(studentB, '<id>'),
    );
    expect(await jobCount(fresh)).toBe(0);
    expect(await jobCount(studentB)).toBe(0);
  });
});
