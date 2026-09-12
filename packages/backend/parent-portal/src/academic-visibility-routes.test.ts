import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { parentPortalPlugin } from './parent-portal-plugin.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-000000000002';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';
const UNLINKED = '00000000-0000-4000-8000-0000000000aa';
const PARENT_USER = '00000000-0000-4000-8000-000000000021';
const STUDENT_USER = STUDENT_ID;
const OTHER_STUDENT = '00000000-0000-4000-8000-0000000000bb';

interface Principal {
  sub: string;
  email?: string;
  roles: Array<{ roleId: string; roleName: string; areaId: string | null }>;
}

function createApp(repository: InMemoryParentPortalRepository): FastifyInstance {
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', null as unknown as Principal);
  app.addHook('onRequest', async (request) => {
    const tenant = request.headers['x-tenant-id'];
    (request as unknown as { tenantId: string }).tenantId =
      typeof tenant === 'string' ? tenant : TENANT_A;
    const principal = request.headers['x-test-principal'];
    (request as unknown as { user: Principal | null }).user =
      typeof principal === 'string' ? (JSON.parse(principal) as Principal) : null;
  });
  return app;
}

function as(principal: Principal, tenantId = TENANT_A) {
  return {
    'x-tenant-id': tenantId,
    'x-test-principal': JSON.stringify(principal),
  };
}

const parent: Principal = {
  sub: PARENT_USER,
  email: 'parent@tenant.test',
  roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
};

const student: Principal = {
  sub: STUDENT_USER,
  email: 'student@tenant.test',
  roles: [{ roleId: 'student', roleName: 'Student', areaId: null }],
};

const otherStudent: Principal = {
  sub: OTHER_STUDENT,
  email: 'other@tenant.test',
  roles: [{ roleId: 'student', roleName: 'Student', areaId: null }],
};

const VIEWS = ['attendance', 'grades', 'timetable', 'homework', 'calendar', 'notices'] as const;

describe('parent/student academic visibility routes', () => {
  let app: FastifyInstance;
  let repository: InMemoryParentPortalRepository;

  beforeEach(async () => {
    repository = new InMemoryParentPortalRepository();
    app = createApp(repository);
    await app.register(parentPortalPlugin, { repository });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 404 when a parent requests an unlinked child on every academic view', async () => {
    await repository.createChildLink({
      id: '00000000-0000-4000-8000-000000000031',
      tenantId: TENANT_A,
      parentUserId: PARENT_USER,
      studentId: STUDENT_ID,
      relationship: 'guardian',
      status: 'active',
      isPrimary: true,
      canConsentMedical: true,
      canViewFees: true,
    });

    for (const view of VIEWS) {
      const linked = await app.inject({
        method: 'GET',
        url: `/parent-portal/children/${STUDENT_ID}/${view}`,
        headers: as(parent),
      });
      expect(linked.statusCode, view).toBe(200);
      const body = linked.json() as { data: unknown[]; meta: { studentId: string } };
      expect(body.data).toEqual([]);
      expect(body.meta.studentId).toBe(STUDENT_ID);

      const unlinked = await app.inject({
        method: 'GET',
        url: `/parent-portal/children/${UNLINKED}/${view}`,
        headers: as(parent),
      });
      expect([403, 404], view).toContain(unlinked.statusCode);
    }
  });

  it('returns 404 when tenant B asks for a child linked only in tenant A', async () => {
    await repository.createChildLink({
      id: '00000000-0000-4000-8000-000000000032',
      tenantId: TENANT_A,
      parentUserId: PARENT_USER,
      studentId: STUDENT_ID,
      relationship: 'guardian',
      status: 'active',
      isPrimary: true,
      canConsentMedical: true,
      canViewFees: true,
    });

    const cross = await app.inject({
      method: 'GET',
      url: `/parent-portal/children/${STUDENT_ID}/attendance`,
      headers: as(parent, TENANT_B),
    });
    expect([403, 404]).toContain(cross.statusCode);
  });

  it('binds /student-portal/me to the JWT subject, not another student', async () => {
    const mine = await app.inject({
      method: 'GET',
      url: '/student-portal/me/attendance',
      headers: as(student),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().meta.studentId).toBe(STUDENT_USER);

    const other = await app.inject({
      method: 'GET',
      url: '/student-portal/me/pal',
      headers: as(otherStudent),
    });
    expect(other.statusCode).toBe(200);
    expect(other.json().meta.studentId).toBe(OTHER_STUDENT);
    expect(other.json().meta.studentId).not.toBe(STUDENT_USER);
  });
});
