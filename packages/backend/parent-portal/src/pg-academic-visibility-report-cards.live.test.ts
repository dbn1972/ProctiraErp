/**
 * D1 (failing-first, live Postgres, runtime role with RLS on): a linked guardian's
 * `GET /parent-portal/children/:id/report-cards` must return the child's completed report card
 * with subject lines built from the card period's published grades.
 *
 * Before the fix the store queried a table that was never created (`report_card_subject_lines`).
 * The 42P01 aborted the `withPgTenant` transaction, the next statement failed with 25P02 and the
 * route answered 500. Negatives: another guardian in the same tenant and the same guardian under
 * another tenant get 404, and a tenant-B store read sees nothing. Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parentPortalPlugin } from './parent-portal-plugin.js';
import { ParentPortalService } from './parent-portal-service.js';
import { PgAcademicVisibilityStore } from './pg-academic-visibility-store.js';
import {
  getSharedParentPortalPool,
  PgParentPortalRepository,
} from './pg-parent-portal-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'pg-academic-visibility-report-cards.live.test',
});
const pool = getSharedParentPortalPool();
const live = Boolean(DATABASE_URL) && pool !== null;

interface Principal {
  sub: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string | null }>;
}

const tenantA = randomUUID();
const tenantB = randomUUID();
const guardianG1 = randomUUID();
const guardianG2 = randomUUID();
const childC = randomUUID();
const childC2 = randomUUID();
const periodP1 = randomUUID();
const periodP2 = randomUUID();
const completedJobId = randomUUID();
const queuedJobId = randomUUID();

function parentPrincipal(sub: string): Principal {
  return { sub, roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }] };
}

function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null as unknown as Principal);
  app.addHook('onRequest', async (request) => {
    const tenant = request.headers['x-tenant-id'];
    (request as unknown as { tenantId: string }).tenantId =
      typeof tenant === 'string' ? tenant : '';
    const principal = request.headers['x-test-principal'];
    (request as unknown as { user: Principal | null }).user =
      typeof principal === 'string' ? (JSON.parse(principal) as Principal) : null;
  });
  return app;
}

/** Household + custody + active guardian link, as the W3-C5 live case does. */
async function linkGuardian(
  service: ParentPortalService,
  tenantId: string,
  parentUserId: string,
  studentId: string,
): Promise<void> {
  const householdId = randomUUID();
  await service.createHousehold(tenantId, { id: householdId, label: `Household ${householdId}` });
  await service.addHouseholdMember(tenantId, { householdId, parentUserId, role: 'primary' });
  await service.assignStudentCustody(tenantId, { studentId, householdId, custodyType: 'sole' });
  await service.linkChild(tenantId, parentUserId, { studentId, householdId }, { isStaff: true });
}

async function seedAcademicData(): Promise<void> {
  const suffix = tenantA.slice(0, 8);
  const areaId = randomUUID();
  const institutionId = randomUUID();
  const sectionS1 = randomUUID();
  const sectionS2 = randomUUID();
  const templateId = randomUUID();
  await withPgTenant(pool!, tenantA, async (client) => {
    await client.query(
      `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
       VALUES ($1, $2, 'Root', 'ROOT', 0, NULL, '/', 1, 2)`,
      [areaId, tenantA],
    );
    await client.query(
      `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
       VALUES ($1, $2, 'Report Card School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
      [institutionId, tenantA, `RC-${suffix}`, areaId],
    );
    await client.query(
      `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
       VALUES ($1, $2, 'Term 1', $3, '2026-04-01', '2026-09-30', 'active'),
              ($4, $2, 'Term 2', $5, '2026-10-01', '2027-03-31', 'active')`,
      [periodP1, tenantA, `T1-${suffix}`, periodP2, `T2-${suffix}`],
    );
    await client.query(
      `INSERT INTO sections (id, tenant_id, institution_id, academic_period_id, code, name)
       VALUES ($1, $2, $3, $4, 'S1', 'Section One'),
              ($5, $2, $3, $6, 'S2', 'Section Two')`,
      [sectionS1, tenantA, institutionId, periodP1, sectionS2, periodP2],
    );
    // E1 published in P1 (visible), E2 unpublished in P1 (hidden), E3 published in P2 (other period).
    await client.query(
      `INSERT INTO grade_entries
         (tenant_id, section_id, student_id, assessment_code, numeric_score, letter_grade, published_at)
       VALUES ($1, $2, $3, 'MATH-T1', 88, 'A', now()),
              ($1, $2, $3, 'SCI-T1', 71, 'B', NULL),
              ($1, $4, $3, 'ENG-T2', 64, 'C', now())`,
      [tenantA, sectionS1, childC, sectionS2],
    );
    await client.query(
      `INSERT INTO report_card_templates (id, tenant_id, name, template_content, is_default)
       VALUES ($1, $2, 'Term card', '<h1>{{student.name}}</h1>', true)`,
      [templateId, tenantA],
    );
    await client.query(
      `INSERT INTO report_card_jobs
         (id, tenant_id, student_id, academic_period_id, template_id, institution_id, status,
          output_url, created_at, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'completed', NULL, now() - interval '1 minute', now()),
              ($7, $2, $3, $4, $5, $6, 'queued', NULL, now(), NULL)`,
      [completedJobId, tenantA, childC, periodP1, templateId, institutionId, queuedJobId],
    );
  });
}

describe('parent report cards on live Postgres (D1)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    if (!live) return;
    await Promise.all([ensurePgTestTenant(pool!, tenantA), ensurePgTestTenant(pool!, tenantB)]);
    await ensurePgTestStudent(pool!, tenantA, childC);
    await ensurePgTestStudent(pool!, tenantA, childC2);
    const repository = new PgParentPortalRepository(pool!);
    const service = new ParentPortalService(repository);
    await linkGuardian(service, tenantA, guardianG1, childC);
    await linkGuardian(service, tenantA, guardianG2, childC2);
    await seedAcademicData();
    app = buildApp();
    await app.register(parentPortalPlugin, {
      repository,
      academicStore: new PgAcademicVisibilityStore(pool!),
    });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  function getReportCards(principal: Principal, tenantId: string, studentId: string) {
    return app.inject({
      method: 'GET',
      url: `/parent-portal/children/${studentId}/report-cards`,
      headers: { 'x-tenant-id': tenantId, 'x-test-principal': JSON.stringify(principal) },
    });
  }

  it.skipIf(!live)(
    'a linked guardian gets the completed card with the period’s published subject lines',
    async () => {
      const res = await getReportCards(parentPrincipal(guardianG1), tenantA, childC);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json() as {
        data: Array<{
          id: string;
          academicPeriodId: string | null;
          status: string;
          outputUrl: string | null;
          subjects: unknown[];
        }>;
        meta: { source: string };
      };
      expect(body.data.map((card) => card.id)).toEqual([completedJobId]);
      expect(body.data[0]).toMatchObject({
        academicPeriodId: periodP1,
        status: 'completed',
        outputUrl: null,
      });
      expect(body.data[0]!.subjects).toEqual([
        { subject: 'MATH-T1', numericScore: 88, letterGrade: 'A', remarks: null },
      ]);
      expect(body.meta.source).toBe('postgres');
    },
  );

  it.skipIf(!live)(
    'another guardian in the same tenant cannot read the child’s cards',
    async () => {
      const res = await getReportCards(parentPrincipal(guardianG2), tenantA, childC);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(completedJobId);
    },
  );

  it.skipIf(!live)(
    'the same guardian under another tenant cannot read the child’s cards',
    async () => {
      const res = await getReportCards(parentPrincipal(guardianG1), tenantB, childC);
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain(completedJobId);
      const crossTenant = await new PgAcademicVisibilityStore(pool!).getReportCards(
        tenantB,
        childC,
      );
      expect(crossTenant.data).toEqual([]);
    },
  );
});
