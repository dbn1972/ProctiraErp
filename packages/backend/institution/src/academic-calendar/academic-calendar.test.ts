/**
 * G-905 — academic calendar through the institution plugin (in-memory deps):
 *  - year → term hierarchy rules on /academic-periods
 *  - calendar events constrained to the period and partitioned per tenant
 *  - dry-run + execute rollover (clone sections, promote enrollments)
 */
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAcademicsDeps, type AcademicsDeps } from '../academics-factory.js';
import { InMemoryInstitutionRepository } from '../in-memory-repository.js';
import { institutionPlugin } from '../institution-plugin.js';

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();

interface Harness {
  app: FastifyInstance;
  deps: AcademicsDeps;
}

async function buildHarness(): Promise<Harness> {
  const repository = new InMemoryInstitutionRepository();
  const deps = createAcademicsDeps({ institutionRepository: repository });
  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    const header = request.headers['x-tenant-id'];
    (request as unknown as { tenantId: string }).tenantId =
      typeof header === 'string' ? header : TENANT_A;
  });
  await app.register(institutionPlugin, { repository, academics: deps });
  await app.ready();
  return { app, deps };
}

async function createPeriod(
  app: FastifyInstance,
  payload: Record<string, unknown>,
  tenant = TENANT_A,
) {
  return app.inject({
    method: 'POST',
    url: '/academic-periods',
    headers: { 'x-tenant-id': tenant },
    payload,
  });
}

async function createYear(app: FastifyInstance, code: string, start: string, end: string) {
  const res = await createPeriod(app, { name: `AY ${code}`, code, startDate: start, endDate: end });
  expect(res.statusCode).toBe(201);
  return res.json() as { id: string; kind: string; parentId: string | null };
}

async function createInstitution(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/institutions',
    payload: {
      name: 'Calendar School',
      code: `CAL-${randomUUID().slice(0, 8)}`,
      areaId: randomUUID(),
      typeId: randomUUID(),
      sectorId: randomUUID(),
      ownershipId: randomUUID(),
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe('G-905 academic calendar', () => {
  let app: FastifyInstance;
  let deps: AcademicsDeps;

  beforeAll(() => {
    vi.stubEnv('DATABASE_URL', '');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    ({ app, deps } = await buildHarness());
  });
  afterEach(async () => {
    await app.close();
  });

  describe('year → term hierarchy', () => {
    it('defaults to a top-level year and nests terms inside it', async () => {
      const year = await createYear(app, 'AY26', '2026-04-01', '2027-03-31');
      expect(year.kind).toBe('year');
      expect(year.parentId).toBeNull();

      const term = await createPeriod(app, {
        name: 'Term 1',
        code: 'AY26-T1',
        kind: 'term',
        parentId: year.id,
        startDate: '2026-04-01',
        endDate: '2026-09-30',
      });
      expect(term.statusCode).toBe(201);
      expect(term.json().kind).toBe('term');
      expect(term.json().parentId).toBe(year.id);

      const children = await app.inject({
        method: 'GET',
        url: `/academic-periods?parentId=${year.id}`,
      });
      expect(children.json()).toHaveLength(1);
      expect(children.json()[0].code).toBe('AY26-T1');

      const years = await app.inject({ method: 'GET', url: '/academic-periods?kind=year' });
      expect(years.json().map((p: { code: string }) => p.code)).toEqual(['AY26']);
    });

    it('rejects a term without a parent, a year with a parent, and a term outside its year', async () => {
      const year = await createYear(app, 'AY26', '2026-04-01', '2027-03-31');

      const orphan = await createPeriod(app, {
        name: 'Orphan',
        code: 'ORPHAN',
        kind: 'term',
        startDate: '2026-04-01',
        endDate: '2026-06-30',
      });
      expect(orphan.statusCode).toBe(400);

      const yearWithParent = await createPeriod(app, {
        name: 'Nested year',
        code: 'NESTED',
        kind: 'year',
        parentId: year.id,
        startDate: '2026-04-01',
        endDate: '2026-06-30',
      });
      expect(yearWithParent.statusCode).toBe(400);

      const outside = await createPeriod(app, {
        name: 'Spills over',
        code: 'SPILL',
        kind: 'semester',
        parentId: year.id,
        startDate: '2027-01-01',
        endDate: '2027-06-30',
      });
      expect(outside.statusCode).toBe(400);

      const term = await createPeriod(app, {
        name: 'T1',
        code: 'T1',
        kind: 'term',
        parentId: year.id,
        startDate: '2026-04-01',
        endDate: '2026-06-30',
      });
      const underTerm = await createPeriod(app, {
        name: 'Q1',
        code: 'Q1',
        kind: 'quarter',
        parentId: term.json().id,
        startDate: '2026-04-01',
        endDate: '2026-05-15',
      });
      expect(underTerm.statusCode).toBe(422);
    });

    it('refuses to delete or demote a year that still owns terms', async () => {
      const year = await createYear(app, 'AY26', '2026-04-01', '2027-03-31');
      await createPeriod(app, {
        name: 'T1',
        code: 'T1',
        kind: 'term',
        parentId: year.id,
        startDate: '2026-04-01',
        endDate: '2026-06-30',
      });

      const del = await app.inject({ method: 'DELETE', url: `/academic-periods/${year.id}` });
      expect(del.statusCode).toBe(422);

      const demote = await app.inject({
        method: 'PUT',
        url: `/academic-periods/${year.id}`,
        payload: { kind: 'term' },
      });
      expect(demote.statusCode).toBe(422);

      const stillThere = await app.inject({ method: 'GET', url: `/academic-periods/${year.id}` });
      expect(stillThere.statusCode).toBe(200);
      expect(stillThere.json().kind).toBe('year');
    });

    it('does not let a term nest under another tenant’s year', async () => {
      const year = await createYear(app, 'AY26', '2026-04-01', '2027-03-31');
      const foreign = await createPeriod(
        app,
        {
          name: 'T1',
          code: 'T1',
          kind: 'term',
          parentId: year.id,
          startDate: '2026-04-01',
          endDate: '2026-06-30',
        },
        TENANT_B,
      );
      expect(foreign.statusCode).toBe(404);
    });
  });

  describe('calendar events', () => {
    it('adds, lists and removes events inside the period range', async () => {
      const year = await createYear(app, 'AY26', '2026-04-01', '2027-03-31');

      const holiday = await app.inject({
        method: 'POST',
        url: `/academic-periods/${year.id}/calendar`,
        payload: {
          kind: 'holiday',
          name: '  Diwali  ',
          startDate: '2026-11-08',
          endDate: '2026-11-10',
          notes: '  ',
        },
      });
      expect(holiday.statusCode).toBe(201);
      expect(holiday.json()).toMatchObject({
        kind: 'holiday',
        name: 'Diwali',
        institutionId: null,
        notes: null,
        academicPeriodId: year.id,
        tenantId: TENANT_A,
      });

      const examWindow = await app.inject({
        method: 'POST',
        url: `/academic-periods/${year.id}/calendar`,
        payload: {
          kind: 'exam_window',
          name: 'Final exams',
          startDate: '2027-03-01',
          endDate: '2027-03-20',
        },
      });
      expect(examWindow.statusCode).toBe(201);

      const list = await app.inject({
        method: 'GET',
        url: `/academic-periods/${year.id}/calendar`,
      });
      expect(list.statusCode).toBe(200);
      expect(list.json().data.map((e: { name: string }) => e.name)).toEqual([
        'Diwali',
        'Final exams',
      ]);

      const removed = await app.inject({
        method: 'DELETE',
        url: `/academic-periods/${year.id}/calendar/${holiday.json().id}`,
      });
      expect(removed.statusCode).toBe(204);

      const after = await app.inject({
        method: 'GET',
        url: `/academic-periods/${year.id}/calendar`,
      });
      expect(after.json().data).toHaveLength(1);
    });

    it('rejects events outside the period, inverted ranges, bad kinds and archived periods', async () => {
      const year = await createYear(app, 'AY26', '2026-04-01', '2027-03-31');
      const post = (payload: Record<string, unknown>) =>
        app.inject({ method: 'POST', url: `/academic-periods/${year.id}/calendar`, payload });

      const outside = await post({
        kind: 'holiday',
        name: 'Too early',
        startDate: '2026-03-01',
        endDate: '2026-03-02',
      });
      expect(outside.statusCode).toBe(400);

      const inverted = await post({
        kind: 'break',
        name: 'Backwards',
        startDate: '2026-12-20',
        endDate: '2026-12-10',
      });
      expect(inverted.statusCode).toBe(400);

      const badKind = await post({
        kind: 'party',
        name: 'Nope',
        startDate: '2026-12-01',
        endDate: '2026-12-01',
      });
      expect(badKind.statusCode).toBe(400);

      const archived = await app.inject({
        method: 'PUT',
        url: `/academic-periods/${year.id}`,
        payload: { status: 'archived' },
      });
      expect(archived.statusCode).toBe(200);
      const onArchived = await post({
        kind: 'holiday',
        name: 'Late',
        startDate: '2026-12-01',
        endDate: '2026-12-01',
      });
      expect(onArchived.statusCode).toBe(422);
    });

    it('partitions events per tenant and 404s on foreign periods', async () => {
      const year = await createYear(app, 'AY26', '2026-04-01', '2027-03-31');
      await app.inject({
        method: 'POST',
        url: `/academic-periods/${year.id}/calendar`,
        payload: { kind: 'holiday', name: 'Holi', startDate: '2027-03-03', endDate: '2027-03-03' },
      });

      const foreignList = await app.inject({
        method: 'GET',
        url: `/academic-periods/${year.id}/calendar`,
        headers: { 'x-tenant-id': TENANT_B },
      });
      expect(foreignList.statusCode).toBe(404);

      const foreignDelete = await app.inject({
        method: 'DELETE',
        url: `/academic-periods/${year.id}/calendar/${randomUUID()}`,
        headers: { 'x-tenant-id': TENANT_B },
      });
      expect(foreignDelete.statusCode).toBe(404);

      const ownList = await app.inject({
        method: 'GET',
        url: `/academic-periods/${year.id}/calendar`,
      });
      expect(ownList.json().data).toHaveLength(1);
    });
  });

  describe('rollover', () => {
    async function seedYearWithSections() {
      const institutionId = await createInstitution(app);
      const source = await createYear(app, 'AY26', '2026-04-01', '2027-03-31');
      const target = await createYear(app, 'AY27', '2027-04-01', '2028-03-31');

      const gradeIds: string[] = [];
      for (const [name, order] of [
        ['Grade 7', 7],
        ['Grade 8', 8],
      ] as const) {
        const grade = await app.inject({
          method: 'POST',
          url: '/grades',
          payload: { name, code: `G${order}`, order },
        });
        expect(grade.statusCode).toBe(201);
        gradeIds.push(grade.json().id as string);
      }
      const [g7, g8] = gradeIds as [string, string];

      const classIds: Record<string, string> = {};
      for (const [gradeId, name] of [
        [g7, '7-A'],
        [g7, '7-B'],
        [g8, '8-A'],
      ] as const) {
        const cls = await app.inject({
          method: 'POST',
          url: '/classes',
          payload: { institutionId, gradeId, academicPeriodId: source.id, name, capacity: 40 },
        });
        expect(cls.statusCode).toBe(201);
        classIds[name] = cls.json().id as string;
      }

      return { institutionId, source, target, g7, g8, classIds };
    }

    async function seedEnrollment(input: {
      institutionId: string;
      periodId: string;
      gradeId: string;
      classId: string | null;
      studentId?: string;
      status?: string;
    }) {
      const studentId = input.studentId ?? randomUUID();
      await deps.prisma.enrollment.create({
        data: {
          tenantId: TENANT_A,
          studentId,
          institutionId: input.institutionId,
          gradeId: input.gradeId,
          classId: input.classId,
          academicPeriodId: input.periodId,
          status: (input.status ?? 'ENROLLED') as never,
          enrolledAt: new Date('2026-04-01'),
        },
      });
      return studentId;
    }

    it('dry-runs by default and reports the plan without writing', async () => {
      const { institutionId, source, target, g7, classIds } = await seedYearWithSections();
      await seedEnrollment({
        institutionId,
        periodId: source.id,
        gradeId: g7,
        classId: classIds['7-A']!,
      });

      const plan = await app.inject({
        method: 'POST',
        url: `/academic-periods/${source.id}/rollover`,
        payload: { targetPeriodId: target.id, promoteEnrollments: true },
      });
      expect(plan.statusCode).toBe(200);
      expect(plan.json()).toMatchObject({
        dryRun: true,
        sourcePeriodId: source.id,
        targetPeriodId: target.id,
        classes: { toCreate: 3, existing: 0, created: 0 },
        enrollments: {
          considered: 1,
          toPromote: 1,
          promoted: 0,
          graduating: 0,
          alreadyInTarget: 0,
        },
      });

      const targetClasses = await app.inject({
        method: 'GET',
        url: `/classes?institutionId=${institutionId}&academicPeriodId=${target.id}`,
      });
      expect(targetClasses.json()).toHaveLength(0);
    });

    it('clones sections, promotes students one grade up and is idempotent on re-run', async () => {
      const { institutionId, source, target, g7, g8, classIds } = await seedYearWithSections();
      const promoted = await seedEnrollment({
        institutionId,
        periodId: source.id,
        gradeId: g7,
        classId: classIds['7-A']!,
      });
      const graduating = await seedEnrollment({
        institutionId,
        periodId: source.id,
        gradeId: g8,
        classId: classIds['8-A']!,
      });
      // Withdrawn students are not carried forward.
      await seedEnrollment({
        institutionId,
        periodId: source.id,
        gradeId: g7,
        classId: classIds['7-B']!,
        status: 'WITHDRAWN',
      });

      const run = await app.inject({
        method: 'POST',
        url: `/academic-periods/${source.id}/rollover`,
        payload: { targetPeriodId: target.id, promoteEnrollments: true, dryRun: false },
      });
      expect(run.statusCode).toBe(200);
      expect(run.json()).toMatchObject({
        dryRun: false,
        classes: { toCreate: 3, existing: 0, created: 3 },
        enrollments: {
          considered: 2,
          toPromote: 1,
          promoted: 1,
          graduating: 1,
          alreadyInTarget: 0,
        },
      });

      const targetClasses = await app.inject({
        method: 'GET',
        url: `/classes?institutionId=${institutionId}&academicPeriodId=${target.id}`,
      });
      expect(
        targetClasses
          .json()
          .map((c: { name: string }) => c.name)
          .sort(),
      ).toEqual(['7-A', '7-B', '8-A']);

      const targetEnrollments = (await deps.prisma.enrollment.findMany({
        where: { tenantId: TENANT_A, academicPeriodId: target.id },
      })) as Array<{ studentId: string; gradeId: string; classId: string | null }>;
      expect(targetEnrollments).toHaveLength(1);
      expect(targetEnrollments[0]).toMatchObject({ studentId: promoted, gradeId: g8 });
      const eightA = targetClasses.json().find((c: { name: string }) => c.name === '8-A') as {
        id: string;
      };
      expect(targetEnrollments[0]!.classId).toBe(eightA.id);
      expect(targetEnrollments.some((e) => e.studentId === graduating)).toBe(false);

      const sourceGraduated = (await deps.prisma.enrollment.findMany({
        where: {
          tenantId: TENANT_A,
          academicPeriodId: source.id,
          studentId: graduating,
        },
      })) as Array<{ status: string; exitedAt: Date | null }>;
      expect(sourceGraduated).toHaveLength(1);
      expect(sourceGraduated[0]).toMatchObject({ status: 'GRADUATED' });
      expect(new Date(sourceGraduated[0]!.exitedAt as Date).toISOString().slice(0, 10)).toBe(
        String(source.endDate).slice(0, 10),
      );

      const again = await app.inject({
        method: 'POST',
        url: `/academic-periods/${source.id}/rollover`,
        payload: { targetPeriodId: target.id, promoteEnrollments: true, dryRun: false },
      });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({
        classes: { toCreate: 0, existing: 3, created: 0 },
        enrollments: {
          // Terminal student is already GRADUATED on source, so only the
          // still-ENROLLED promoted row is considered on re-run.
          considered: 1,
          toPromote: 0,
          promoted: 0,
          graduating: 0,
          alreadyInTarget: 1,
        },
      });
      expect(
        await deps.prisma.enrollment.count({
          where: { tenantId: TENANT_A, academicPeriodId: target.id },
        }),
      ).toBe(1);
    });

    it('rejects same-period, backwards, archived and cross-tenant targets', async () => {
      const { source, target } = await seedYearWithSections();
      const post = (payload: Record<string, unknown>, tenant = TENANT_A) =>
        app.inject({
          method: 'POST',
          url: `/academic-periods/${source.id}/rollover`,
          headers: { 'x-tenant-id': tenant },
          payload,
        });

      expect((await post({ targetPeriodId: source.id })).statusCode).toBe(400);

      const earlier = await createYear(app, 'AY25', '2025-04-01', '2026-03-31');
      expect((await post({ targetPeriodId: earlier.id })).statusCode).toBe(422);

      await app.inject({
        method: 'PUT',
        url: `/academic-periods/${target.id}`,
        payload: { status: 'archived' },
      });
      expect((await post({ targetPeriodId: target.id })).statusCode).toBe(422);

      expect((await post({ targetPeriodId: target.id }, TENANT_B)).statusCode).toBe(404);
      expect((await post({ targetPeriodId: 'not-a-uuid' })).statusCode).toBe(400);
    });
  });
});
