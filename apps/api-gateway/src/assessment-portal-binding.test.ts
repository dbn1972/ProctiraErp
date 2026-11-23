/**
 * PRC-L274: the family report-card download honours the parent portal's custody
 * rule. An active child link is not enough: the guardian's household must hold
 * active custody and no blocks_all_access restriction may apply. Otherwise the
 * download is 404, the same as for a child the guardian is not linked to.
 */
import {
  InMemoryAssessmentItemRepository,
  InMemoryAssessmentResultRepository,
  InMemoryGradingSchemeRepository,
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardArtifactStore,
  InMemoryReportCardJobRepository,
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
  ReportCardPdfGenerator,
  ReportCardService,
  ResultService,
  registerReportCardRoutes,
  type ReportCardDirectory,
} from '@proctira/backend-assessment';
import {
  InMemoryParentPortalRepository,
  ParentPortalService,
} from '@proctira/backend-parent-portal';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAssessmentPortalBinding } from './assessment-portal-binding.js';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GUARDIAN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HOUSEHOLD = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
/** Linked, household holds custody, no restriction. */
const KID_OK = '33333333-3333-4333-8333-333333333333';
/** Linked, but the student has no custody rows. */
const KID_NO_CUSTODY = '44444444-4444-4444-8444-444444444444';
/** Linked, household holds custody, but a blocks_all_access order applies. */
const KID_BLOCKED = '55555555-5555-4555-8555-555555555555';
const PERIOD = '22222222-2222-4222-8222-222222222222';
const INSTITUTION = '66666666-6666-4666-8666-666666666666';

const directory: ReportCardDirectory = {
  async findStudentName(_tenantId, studentId) {
    return `Student ${studentId.slice(0, 8)}`;
  },
  async findSubjectNames(_tenantId, subjectIds) {
    return new Map(subjectIds.map((id) => [id, `Subject ${id.slice(0, 8)}`]));
  },
  async findAcademicPeriodName(_tenantId, academicPeriodId) {
    return `Period ${academicPeriodId.slice(0, 8)}`;
  },
};

describe('family report-card download follows the custody rule (PRC-L274)', () => {
  let app: FastifyInstance;
  let user: { sub: string; roles: unknown[] } = { sub: 'coord', roles: ['academic_coordinator'] };
  const jobs: Record<string, string> = {};

  beforeEach(async () => {
    const parentRepository = new InMemoryParentPortalRepository();
    const parentPortal = new ParentPortalService(parentRepository);
    await parentPortal.createHousehold(TENANT, { id: HOUSEHOLD, label: 'Family' });
    await parentPortal.addHouseholdMember(TENANT, {
      householdId: HOUSEHOLD,
      parentUserId: GUARDIAN,
      role: 'primary',
    });
    for (const studentId of [KID_OK, KID_NO_CUSTODY, KID_BLOCKED]) {
      await parentPortal.linkChild(TENANT, GUARDIAN, { studentId }, { isStaff: true });
    }
    for (const studentId of [KID_OK, KID_BLOCKED]) {
      await parentPortal.assignStudentCustody(TENANT, { studentId, householdId: HOUSEHOLD });
    }
    await parentPortal.createCustodyRestriction(TENANT, {
      studentId: KID_BLOCKED,
      parentUserId: GUARDIAN,
      blocksAllAccess: true,
    });

    const itemRepo = new InMemoryAssessmentItemRepository();
    const resultService = new ResultService(
      new InMemoryAssessmentResultRepository(),
      itemRepo,
      new InMemoryGradingSchemeRepository(),
    );
    const reportCardService = new ReportCardService(
      new InMemoryReportCardTemplateRepository(),
      new InMemoryTeacherCommentRepository(),
      new InMemoryInstitutionBrandingRepository(),
      new InMemoryReportCardJobRepository(),
      resultService,
      itemRepo,
      null,
      new ReportCardPdfGenerator(),
      { artifactStore: new InMemoryReportCardArtifactStore(), processInline: true, directory },
    );
    app = Fastify();
    app.addHook('onRequest', async (request) => {
      (request as unknown as { tenantId: string }).tenantId = TENANT;
      (request as unknown as { user: unknown }).user = user;
    });
    await registerReportCardRoutes(app, {
      reportCardService,
      teachingScope: null,
      portalBinding: createAssessmentPortalBinding(parentRepository, async () => []),
    });
    await app.ready();

    user = { sub: 'coord', roles: ['academic_coordinator'] };
    const template = await app.inject({
      method: 'POST',
      url: '/report-cards/templates',
      payload: { name: 'Default', templateContent: '<title>Term</title>', isDefault: true },
    });
    const templateId = (template.json() as { id: string }).id;
    for (const studentId of [KID_OK, KID_NO_CUSTODY, KID_BLOCKED]) {
      const gen = await app.inject({
        method: 'POST',
        url: '/report-cards/generate',
        payload: { studentId, academicPeriodId: PERIOD, templateId, institutionId: INSTITUTION },
      });
      expect(gen.statusCode).toBe(202);
      jobs[studentId] = (gen.json() as { id: string }).id;
    }
  });

  afterEach(async () => {
    await app.close();
  });

  const download = (studentId: string) =>
    app.inject({ method: 'GET', url: `/report-cards/jobs/${jobs[studentId]}/download` });

  for (const role of ['guardian', 'parent']) {
    it(`${role} downloads the card of a child in their custody`, async () => {
      user = { sub: GUARDIAN, roles: [role] };
      const res = await download(KID_OK);
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
    });

    it(`${role} with an active link but no custody household gets 404`, async () => {
      user = { sub: GUARDIAN, roles: [role] };
      expect((await download(KID_NO_CUSTODY)).statusCode).toBe(404);
    });

    it(`${role} with an active link and a blocks_all_access restriction gets 404`, async () => {
      user = { sub: GUARDIAN, roles: [role] };
      expect((await download(KID_BLOCKED)).statusCode).toBe(404);
    });
  }
});
