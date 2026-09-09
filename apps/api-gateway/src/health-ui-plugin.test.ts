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
        expect.objectContaining({ id: 'f1f1f1f1-0000-4000-8000-000000000001', name: 'Grade 6 dental' }),
      ]);
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
