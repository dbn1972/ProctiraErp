/**
 * Unit tests for Health UI aggregate routes (tenant + RBAC gates).
 */
import { InMemoryHealthRepository } from '@proctira/backend-health';
import Fastify, { type FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { healthUiPlugin } from './health-ui-plugin.js';
import { HEALTH_DEMO_TENANT_ID, HEALTH_STUDENT_A_ID } from './health-ui-seed.js';

type TestUser = {
  sub: string;
  tenantId?: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string }>;
  institutions?: string[];
};

function setUser(request: FastifyRequest, user: TestUser, tenantId?: string) {
  const req = request as FastifyRequest & { user?: TestUser; tenantId?: string };
  // Test doubles intentionally omit full JwtPayload fields.
  req.user = user as FastifyRequest['user'] & TestUser;
  if (tenantId) req.tenantId = tenantId;
}

describe('healthUiPlugin', () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    while (apps.length) {
      const app = apps.pop();
      if (app) await app.close();
    }
  });

  async function buildApp() {
    const app = Fastify();
    apps.push(app);
    await app.register(healthUiPlugin);
    await app.ready();
    return app;
  }

  it('returns 403 when caller lacks a health role', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/health/records',
      headers: { 'x-tenant-id': HEALTH_DEMO_TENANT_ID },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 when health role is present but tenant is missing', async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(request, {
        sub: 'u1',
        roles: [{ roleId: 'health-officer', roleName: 'HEALTH_OFFICER', areaId: 'area-1' }],
      });
    });
    await app.register(healthUiPlugin);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health/records' });
    expect(res.statusCode).toBe(400);
  });

  it('returns seeded records for matching tenant + health role', async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(
        request,
        {
          sub: 'u1',
          tenantId: HEALTH_DEMO_TENANT_ID,
          roles: [{ roleId: 'health-officer', roleName: 'HEALTH_OFFICER', areaId: 'area-1' }],
        },
        HEALTH_DEMO_TENANT_ID,
      );
    });
    await app.register(healthUiPlugin);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/health/records',
      headers: { 'x-tenant-id': HEALTH_DEMO_TENANT_ID },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ studentId: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((r) => r.studentId === HEALTH_STUDENT_A_ID)).toBe(true);
  });

  it('returns empty list for a different tenant (cross-tenant deny)', async () => {
    const otherTenant = '11111111-1111-4111-8111-111111111111';
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(
        request,
        {
          sub: 'u1',
          tenantId: otherTenant,
          roles: [{ roleId: 'health-officer', roleName: 'HEALTH_OFFICER', areaId: 'area-1' }],
        },
        otherTenant,
      );
    });
    await app.register(healthUiPlugin);
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/health/records',
      headers: { 'x-tenant-id': otherTenant },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: unknown[] }).data).toEqual([]);
  });

  it('returns screenings for authorized tenant', async () => {
    const app = Fastify();
    apps.push(app);
    app.addHook('onRequest', async (request) => {
      setUser(
        request,
        {
          sub: 'u1',
          roles: [{ roleId: 'nurse', roleName: 'NURSE', areaId: 'area-1' }],
        },
        HEALTH_DEMO_TENANT_ID,
      );
    });
    await app.register(healthUiPlugin);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/health/screenings' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: unknown[] };
    expect(body.data.length).toBeGreaterThan(0);
  });

  describe('G-912 — lists are built from domain rows, not only the seed', () => {
    const TENANT = '00000000-0000-4000-8000-0000000000e1';
    const OTHER = '00000000-0000-4000-8000-0000000000e2';
    const STUDENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa91';
    const SCHOOL_A = '5c000000-0000-4000-8000-00000000000a';
    const SCHOOL_B = '5c000000-0000-4000-8000-00000000000b';

    async function buildLiveApp(repository: InMemoryHealthRepository, tenantId = TENANT) {
      const app = Fastify();
      apps.push(app);
      app.addHook('onRequest', async (request) => {
        setUser(
          request,
          {
            sub: 'nurse-1',
            tenantId,
            roles: [{ roleId: 'nurse', roleName: 'NURSE', areaId: 'area-1' }],
            // PRC-H006: a school nurse is scoped to their school.
            institutions: [SCHOOL_A],
          },
          tenantId,
        );
      });
      // Production shape: no seed rows at all.
      await app.register(healthUiPlugin, {
        seed: { records: [], specialNeeds: [], counselling: [], screenings: [] },
        repository,
      });
      await app.ready();
      return app;
    }

    async function seedDomain(repository: InMemoryHealthRepository) {
      repository.setStudentInstitution(TENANT, STUDENT, SCHOOL_A);
      repository.setStudentInstitution(OTHER, 'other-student', SCHOOL_A);
      await repository.createAllergy({
        id: 'a1a1a1a1-0000-4000-8000-000000000001',
        tenantId: TENANT,
        studentId: STUDENT,
        allergyType: 'food',
        description: 'Peanuts',
        severity: 'severe',
        reaction: 'Anaphylaxis',
        treatment: 'EpiPen',
        diagnosedDate: '2024-01-10',
      });
      await repository.createCondition({
        id: 'c1c1c1c1-0000-4000-8000-000000000001',
        tenantId: TENANT,
        studentId: STUDENT,
        conditionName: 'Asthma',
        conditionType: 'chronic',
        diagnosedDate: '2023-05-01',
        status: 'active',
        treatment: null,
        medication: 'Inhaler',
        notes: null,
      });
      await repository.createCondition({
        id: 'c1c1c1c1-0000-4000-8000-000000000002',
        tenantId: TENANT,
        studentId: STUDENT,
        conditionName: 'Chickenpox',
        conditionType: 'acute',
        diagnosedDate: '2022-02-01',
        status: 'resolved',
        treatment: null,
        medication: null,
        notes: null,
      });
      await repository.createDiagnosis({
        id: 'd1d1d1d1-0000-4000-8000-000000000001',
        tenantId: TENANT,
        studentId: STUDENT,
        assessmentId: null,
        diagnosisDate: '2025-06-01',
        diagnosedBy: 'Dr Rao',
        condition: 'Dyslexia',
        category: 'Learning support',
        severity: 'moderate',
        notes: null,
      });
      await repository.createAccommodationPlan({
        id: 'e1e1e1e1-0000-4000-8000-000000000001',
        tenantId: TENANT,
        studentId: STUDENT,
        diagnosisId: 'd1d1d1d1-0000-4000-8000-000000000001',
        planName: 'IEP 2026',
        startDate: '2026-06-01',
        endDate: null,
        accommodations: [{ type: 'exam', description: 'Extra time on exams' }],
        reviewDate: null,
        status: 'active',
        notes: null,
      });
      await repository.createScreeningProgram({
        id: 'f1f1f1f1-0000-4000-8000-000000000001',
        tenantId: TENANT,
        name: 'Grade 6 dental',
        description: null,
        gradeLevel: '6',
        academicPeriodId: 'ap-1',
        assessmentTypes: ['dental'],
        scheduledDate: '2026-10-01',
        status: 'planned',
      });
      // Another tenant's rows must never leak.
      await repository.createAllergy({
        id: 'a1a1a1a1-0000-4000-8000-0000000000ff',
        tenantId: OTHER,
        studentId: 'other-student',
        allergyType: 'drug',
        description: 'Penicillin',
        severity: 'mild',
        reaction: null,
        treatment: null,
        diagnosedDate: null,
      });
    }

    it('records aggregate folds allergies + active conditions per student', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      const app = await buildLiveApp(repository);

      const list = await app.inject({ method: 'GET', url: '/health/records' });
      expect(list.statusCode).toBe(200);
      const body = list.json() as {
        data: Array<{ studentId: string; allergies: string[]; chronicConditions: string[] }>;
        meta: { source: string; liveCount: number; seedCount: number };
      };
      expect(body.meta).toEqual({ source: 'live+seed', liveCount: 1, seedCount: 0 });
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        studentId: STUDENT,
        allergies: ['Peanuts'],
        chronicConditions: ['Asthma'],
      });

      const detail = await app.inject({ method: 'GET', url: `/health/records/${STUDENT}` });
      expect(detail.statusCode).toBe(200);
      expect((detail.json() as { allergies: string[] }).allergies).toEqual(['Peanuts']);

      const missing = await app.inject({ method: 'GET', url: '/health/records/nobody' });
      expect(missing.statusCode).toBe(404);
    });

    it('special-needs aggregate uses latest diagnosis + active plan', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      const app = await buildLiveApp(repository);
      const res = await app.inject({ method: 'GET', url: '/health/special-needs' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { data: unknown[] };
      expect(body.data).toEqual([
        expect.objectContaining({
          studentId: STUDENT,
          category: 'Learning support',
          severity: 'MODERATE',
          accommodations: ['Extra time on exams'],
          iepActive: true,
        }),
      ]);
    });

    it('screenings aggregate lists domain programs', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      const app = await buildLiveApp(repository);
      const res = await app.inject({ method: 'GET', url: '/health/screenings' });
      const body = res.json() as { data: Array<{ id: string; name: string }> };
      expect(body.data).toEqual([
        expect.objectContaining({
          id: 'f1f1f1f1-0000-4000-8000-000000000001',
          name: 'Grade 6 dental',
        }),
      ]);
    });

    // ── PRC-H006: need-to-know scope, PHI read audit and counselling ACL ─────────────
    const STUDENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb92';

    async function appAs(repository: InMemoryHealthRepository, user: Partial<TestUser>) {
      const app = Fastify();
      apps.push(app);
      app.addHook('onRequest', async (request) => {
        setUser(
          request,
          {
            sub: 'actor-1',
            tenantId: TENANT,
            roles: [{ roleId: 'nurse', roleName: 'NURSE', areaId: 'area-1' }],
            institutions: [SCHOOL_A],
            ...user,
          },
          TENANT,
        );
      });
      await app.register(healthUiPlugin, {
        seed: { records: [], specialNeeds: [], counselling: [], screenings: [] },
        repository,
      });
      await app.ready();
      return app;
    }

    async function seedSchoolB(repository: InMemoryHealthRepository) {
      repository.setStudentInstitution(TENANT, STUDENT_B, SCHOOL_B);
      await repository.createAllergy({
        id: 'a1a1a1a1-0000-4000-8000-0000000000b1',
        tenantId: TENANT,
        studentId: STUDENT_B,
        allergyType: 'food',
        description: 'Shellfish',
        severity: 'severe',
        reaction: null,
        treatment: null,
        diagnosedDate: null,
      });
      await repository.createDiagnosis({
        id: 'd1d1d1d1-0000-4000-8000-0000000000b1',
        tenantId: TENANT,
        studentId: STUDENT_B,
        assessmentId: null,
        diagnosisDate: '2025-06-01',
        diagnosedBy: 'Dr B',
        condition: 'ADHD',
        category: 'Attention',
        severity: 'mild',
        notes: null,
      });
      for (const [id, studentId] of [
        ['9c000000-0000-4000-8000-0000000000a1', STUDENT],
        ['9c000000-0000-4000-8000-0000000000b1', STUDENT_B],
      ] as const) {
        await repository.createCounsellingSession({
          id,
          tenantId: TENANT,
          studentId,
          counsellorId: 'counsellor-1',
          sessionDate: '2026-02-01',
          sessionType: 'individual',
          reason: 'Family bereavement',
          caseNotes: 'confidential',
          outcome: null,
          followUpRequired: false,
          followUpDate: null,
          status: 'scheduled',
        });
      }
    }

    it('nurse bound to school A gets no rows for a school-B student', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      await seedSchoolB(repository);
      const app = await appAs(repository, {});
      for (const url of ['/health/records', '/health/special-needs', '/health/counselling']) {
        const res = await app.inject({ method: 'GET', url });
        expect(res.statusCode, url).toBe(200);
        const ids = (res.json() as { data: Array<{ studentId: string }> }).data.map(
          (r) => r.studentId,
        );
        expect(ids, url).not.toContain(STUDENT_B);
        expect(ids, url).toContain(STUDENT);
      }
      const detail = await app.inject({ method: 'GET', url: `/health/records/${STUDENT_B}` });
      expect(detail.statusCode).toBe(404);
    });

    it('a school-bound role with no institution scope sees no live PHI', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      const app = await appAs(repository, { institutions: [] });
      const res = await app.inject({ method: 'GET', url: '/health/records' });
      expect((res.json() as { data: unknown[] }).data).toEqual([]);
    });

    it('authoritative staff assignments override broader JWT institution claims', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      await seedSchoolB(repository);
      // JWT claims both schools, but the nurse is only assigned to school A.
      repository.setActorInstitutions(TENANT, 'actor-1', [SCHOOL_A]);
      const app = await appAs(repository, { institutions: [SCHOOL_A, SCHOOL_B] });
      const res = await app.inject({ method: 'GET', url: '/health/records' });
      const ids = (res.json() as { data: Array<{ studentId: string }> }).data.map(
        (r) => r.studentId,
      );
      expect(ids).toEqual([STUDENT]);
    });

    it('a tenant-wide health admin sees every school', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      await seedSchoolB(repository);
      const app = await appAs(repository, {
        roles: [{ roleId: 'health_admin', roleName: 'HEALTH_ADMIN', areaId: 'area-1' }],
        institutions: [],
      });
      const res = await app.inject({ method: 'GET', url: '/health/records' });
      const ids = (res.json() as { data: Array<{ studentId: string }> }).data.map(
        (r) => r.studentId,
      );
      expect(ids.sort()).toEqual([STUDENT, STUDENT_B].sort());
    });

    it('each read writes a PHI access log row per returned student', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      await seedSchoolB(repository);
      const app = await appAs(repository, {});
      await app.inject({ method: 'GET', url: '/health/records' });
      await app.inject({ method: 'GET', url: `/health/records/${STUDENT}` });
      const logs = await repository.listPhiAccessLogs(TENANT);
      const types = logs.filter((l) => l.actorUserId === 'actor-1').map((l) => l.resourceType);
      expect(types).toEqual(expect.arrayContaining(['health_record.list', 'health_record.detail']));
      expect(logs.some((l) => l.studentId === STUDENT_B)).toBe(false);
    });

    it('fails closed with 503 when the PHI auditor fails in production', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      repository.logPhiAccess = async () => {
        throw new Error('audit store down');
      };
      const savedEnv = process.env.NODE_ENV;
      const savedDegrade = process.env.ALLOW_PHI_AUDIT_DEGRADE;
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_PHI_AUDIT_DEGRADE;
      try {
        await seedSchoolB(repository);
        const app = await appAs(repository, {});
        for (const url of [
          '/health/records',
          `/health/records/${STUDENT}`,
          '/health/special-needs',
          '/health/counselling',
        ]) {
          const res = await app.inject({ method: 'GET', url });
          expect(res.statusCode, url).toBe(503);
          const body = JSON.stringify(res.json());
          expect(body, url).not.toContain('Peanuts');
          // Driver/auditor detail stays in server logs.
          expect(body, url).not.toContain('audit store down');
        }
      } finally {
        process.env.NODE_ENV = savedEnv;
        if (savedDegrade === undefined) delete process.env.ALLOW_PHI_AUDIT_DEGRADE;
        else process.env.ALLOW_PHI_AUDIT_DEGRADE = savedDegrade;
      }
    });

    it('nurse cannot read counselling topic; counsellor can', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      await seedSchoolB(repository);
      const nurse = await appAs(repository, {});
      const nurseRows = (
        await nurse.inject({ method: 'GET', url: '/health/counselling' })
      ).json() as {
        data: Array<{ studentId: string; topic: string }>;
      };
      expect(nurseRows.data).toHaveLength(1);
      expect(nurseRows.data[0]!.topic).toBe('');

      const counsellor = await appAs(repository, {
        roles: [{ roleId: 'counsellor', roleName: 'COUNSELLOR', areaId: 'area-1' }],
      });
      const counsellorRows = (
        await counsellor.inject({ method: 'GET', url: '/health/counselling' })
      ).json() as { data: Array<{ topic: string }> };
      expect(counsellorRows.data[0]!.topic).toBe('Family bereavement');
    });

    it('PRC-M476: a no-show session is reported as NO_SHOW, not CANCELLED/SCHEDULED', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      await repository.createCounsellingSession({
        id: '9c000000-0000-4000-8000-0000000000a2',
        tenantId: TENANT,
        studentId: STUDENT,
        counsellorId: 'counsellor-1',
        sessionDate: '2026-02-02',
        sessionType: 'individual',
        reason: 'Follow-up',
        caseNotes: null,
        outcome: null,
        followUpRequired: false,
        followUpDate: null,
        status: 'no-show',
      });
      const counsellor = await appAs(repository, {
        roles: [{ roleId: 'counsellor', roleName: 'COUNSELLOR', areaId: 'area-1' }],
      });
      const rows = (
        await counsellor.inject({ method: 'GET', url: '/health/counselling' })
      ).json() as { data: Array<{ id: string; status: string }> };
      const noShow = rows.data.find((r) => r.id === '9c000000-0000-4000-8000-0000000000a2');
      expect(noShow?.status).toBe('NO_SHOW');
    });
    it('cross-tenant: the other tenant sees none of these rows', async () => {
      const repository = new InMemoryHealthRepository();
      await seedDomain(repository);
      const app = await buildLiveApp(repository, OTHER);
      const records = (await app.inject({ method: 'GET', url: '/health/records' })).json() as {
        data: Array<{ studentId: string }>;
      };
      expect(records.data.map((r) => r.studentId)).toEqual(['other-student']);
      for (const url of ['/health/special-needs', '/health/screenings']) {
        const res = await app.inject({ method: 'GET', url });
        expect((res.json() as { data: unknown[] }).data).toEqual([]);
      }
    });
  });
});
