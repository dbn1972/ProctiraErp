/**
 * M4-P3: `POST /assessment-items` and `POST /outcomes` must refuse a subject or academic period
 * id that does not belong to the caller's tenant, with the #739 safe 422 body (fixed copy,
 * correlation id), and store nothing.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssessmentService } from './assessment-service.js';
import {
  InMemoryAssessmentItemRepository,
  InMemoryGradingSchemeRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { InMemoryReportCardDirectory } from './report-card-directory.js';
import { registerAssessmentRoutes } from './routes.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const SUBJECT_A = '11111111-1111-4111-8111-1111111111aa';
const SUBJECT_B = '11111111-1111-4111-8111-1111111111bb';
const PERIOD_A = '22222222-2222-4222-8222-2222222222aa';
const PERIOD_B = '22222222-2222-4222-8222-2222222222bb';
const UNKNOWN = '33333333-3333-4333-8333-333333333333';
const SAFE_BODY = {
  code: 'REFERENCE_NOT_FOUND',
  message: 'A referenced record does not exist.',
  statusCode: 422,
};

describe('M4-P3 items and outcomes reference only the tenant subject and period', () => {
  let app: FastifyInstance;
  let items: InMemoryAssessmentItemRepository;
  let outcomes: InMemoryOutcomeRepository;

  beforeEach(async () => {
    const directory = new InMemoryReportCardDirectory()
      .addSubject(TENANT_A, SUBJECT_A, 'A Maths')
      .addPeriod(TENANT_A, PERIOD_A, 'A Year')
      .addSubject(TENANT_B, SUBJECT_B, 'B Maths')
      .addPeriod(TENANT_B, PERIOD_B, 'B Year');
    items = new InMemoryAssessmentItemRepository();
    outcomes = new InMemoryOutcomeRepository();
    const service = new AssessmentService(
      new InMemoryGradingSchemeRepository(),
      items,
      outcomes,
      undefined,
      { referenceDirectory: directory },
    );
    app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId: string }).tenantId = String(
        request.headers['x-test-tenant'],
      );
    });
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
        sub: 'admin-user',
        roles: ['admin'],
      };
    });
    await registerAssessmentRoutes(app, { assessmentService: service });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  async function post(tenant: string, url: string, payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url, payload, headers: { 'x-test-tenant': tenant } });
  }
  async function schemeOf(tenant: string): Promise<string> {
    const res = await post(tenant, '/grading-schemes', {
      name: `Scheme ${tenant.slice(-2)}`,
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [
        { grade: 'A', minScore: 80, maxScore: 100 },
        { grade: 'B', minScore: 0, maxScore: 79.99 },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    return (res.json() as { id: string }).id;
  }
  function expectSafe(res: { statusCode: number; body: string }, label: string) {
    expect(res.statusCode, `${label}: ${res.body}`).toBe(422);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body, label).toMatchObject(SAFE_BODY);
    expect(typeof body.correlationId, label).toBe('string');
    expect(String(body.correlationId).length, label).toBeGreaterThan(0);
  }
  const itemSet = [{ name: 'Final', weight: 100, minScore: 0, maxScore: 100 }];

  it("refuses items on another tenant's subject or period, or an unknown subject", async () => {
    const schemeB = await schemeOf(TENANT_B);
    for (const [subjectId, academicPeriodId, label] of [
      [SUBJECT_A, PERIOD_A, "A's subject and period"],
      [SUBJECT_A, PERIOD_B, "A's subject"],
      [SUBJECT_B, PERIOD_A, "A's period"],
      [UNKNOWN, PERIOD_B, 'unknown subject'],
      [SUBJECT_B, UNKNOWN, 'unknown period'],
    ] as const) {
      const res = await post(TENANT_B, '/assessment-items', {
        subjectId,
        academicPeriodId,
        gradingSchemeId: schemeB,
        items: itemSet,
      });
      expectSafe(res, label);
    }
    expect(await items.findBySubjectAndPeriod(TENANT_B, SUBJECT_A, PERIOD_A)).toEqual([]);
    expect(await items.findBySubjectAndPeriod(TENANT_A, SUBJECT_A, PERIOD_A)).toEqual([]);
  });

  it("refuses an outcome on another tenant's subject or an unknown subject", async () => {
    for (const subjectId of [SUBJECT_A, UNKNOWN]) {
      const res = await post(TENANT_B, '/outcomes', { subjectId, code: 'O1', name: 'Fractions' });
      expectSafe(res, `outcome on ${subjectId}`);
    }
    expect(await outcomes.findBySubject(TENANT_B, SUBJECT_A)).toEqual([]);
    expect(await outcomes.findBySubject(TENANT_A, SUBJECT_A)).toEqual([]);
  });

  it("still saves items and outcomes on the tenant's own subject and period", async () => {
    const schemeB = await schemeOf(TENANT_B);
    const saved = await post(TENANT_B, '/assessment-items', {
      subjectId: SUBJECT_B,
      academicPeriodId: PERIOD_B,
      gradingSchemeId: schemeB,
      items: itemSet,
    });
    expect(saved.statusCode, saved.body).toBe(201);
    expect((saved.json() as { totalWeight: number }).totalWeight).toBe(100);
    const outcome = await post(TENANT_B, '/outcomes', {
      subjectId: SUBJECT_B,
      code: 'O1',
      name: 'Fractions',
    });
    expect(outcome.statusCode, outcome.body).toBe(201);
    expect(await outcomes.findBySubject(TENANT_B, SUBJECT_B)).toHaveLength(1);
  });

  it('an unknown grading scheme stays a 404, checked before the subject', async () => {
    const res = await post(TENANT_B, '/assessment-items', {
      subjectId: SUBJECT_A,
      academicPeriodId: PERIOD_A,
      gradingSchemeId: UNKNOWN,
      items: itemSet,
    });
    expect(res.statusCode, res.body).toBe(404);
  });
});
