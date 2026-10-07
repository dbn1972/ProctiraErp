/**
 * PRC-H075 — a student principal binds to exactly one student record through an explicit
 * identity link (`students.id = sub` or `custom_data.user_id = sub`). Shared/guardian emails and
 * `contacts[0]` never bind, an ambiguous link fails closed (409), and the Postgres lookup has no
 * `LIMIT 1` that could pick an arbitrary sibling.
 */
import { ConflictError } from '@proctira/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  InMemoryAcademicVisibilityStore,
  selectBoundStudentId,
  type InMemoryStudentIdentityRecord,
} from './academic-visibility.js';
import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { parentPortalPlugin } from './parent-portal-plugin.js';
import { PgAcademicVisibilityStore } from './pg-academic-visibility-store.js';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-000000000002';
const SIBLING_A = '00000000-0000-4000-8000-0000000000a1';
const SIBLING_B = '00000000-0000-4000-8000-0000000000b1';
const STUDENT_A_ACCOUNT = '00000000-0000-4000-8000-0000000000c1';
const UNLINKED_ACCOUNT = '00000000-0000-4000-8000-0000000000c2';
const FAMILY_EMAIL = 'family@example.test';

interface Principal {
  sub: string;
  email?: string;
  email_verified?: boolean;
  roles: Array<{ roleId: string; roleName: string; areaId: string | null }>;
}

const STUDENT_ROLE = [{ roleId: 'student', roleName: 'Student', areaId: null }];

/** Two siblings whose records carry the same guardian contact and email (common in real data). */
function siblings(
  overrides: Partial<Record<'a' | 'b', Partial<InMemoryStudentIdentityRecord>>> = {},
) {
  return [
    {
      id: SIBLING_A,
      tenantId: TENANT_A,
      email: FAMILY_EMAIL,
      contacts: [{ type: 'email', value: FAMILY_EMAIL }],
      ...overrides.a,
    },
    {
      id: SIBLING_B,
      tenantId: TENANT_A,
      email: FAMILY_EMAIL,
      contacts: [{ type: 'email', value: FAMILY_EMAIL }],
      ...overrides.b,
    },
  ] satisfies InMemoryStudentIdentityRecord[];
}

async function buildApp(students: InMemoryStudentIdentityRecord[]): Promise<FastifyInstance> {
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
  await app.register(parentPortalPlugin, {
    repository: new InMemoryParentPortalRepository(),
    academicStore: new InMemoryAcademicVisibilityStore(students),
  });
  await app.ready();
  return app;
}

function as(principal: Principal, tenantId = TENANT_A) {
  return { 'x-tenant-id': tenantId, 'x-test-principal': JSON.stringify(principal) };
}

const VIEWS = ['attendance', 'grades', 'timetable', 'homework', 'calendar', 'notices', 'pal'];

describe('student self-binding (PRC-H075)', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('never binds a shared family email to a sibling record (404 on every view)', async () => {
    app = await buildApp(siblings());
    const caller: Principal = {
      sub: UNLINKED_ACCOUNT,
      email: FAMILY_EMAIL,
      email_verified: true,
      roles: STUDENT_ROLE,
    };
    for (const view of VIEWS) {
      const res = await app.inject({
        method: 'GET',
        url: `/student-portal/me/${view}`,
        headers: as(caller),
      });
      expect(res.statusCode, view).toBe(404);
      expect(res.body, view).not.toContain(SIBLING_A);
      expect(res.body, view).not.toContain(SIBLING_B);
    }
  });

  it('does not bind on an unverified email claim', async () => {
    app = await buildApp([{ id: SIBLING_A, tenantId: TENANT_A, email: 'student-a@example.test' }]);
    const res = await app.inject({
      method: 'GET',
      url: '/student-portal/me/attendance',
      headers: as({
        sub: UNLINKED_ACCOUNT,
        email: 'student-a@example.test',
        email_verified: false,
        roles: STUDENT_ROLE,
      }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(SIBLING_A);
  });

  it('does not fall back to the JWT sub as a students.id when no record is linked', async () => {
    app = await buildApp(siblings());
    const res = await app.inject({
      method: 'GET',
      url: '/student-portal/me/grades',
      headers: as({ sub: UNLINKED_ACCOUNT, roles: STUDENT_ROLE }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(UNLINKED_ACCOUNT);
  });

  it('binds the correctly linked student even when a sibling shares the email', async () => {
    app = await buildApp(siblings({ a: { userId: STUDENT_A_ACCOUNT } }));
    for (const view of VIEWS) {
      const res = await app.inject({
        method: 'GET',
        url: `/student-portal/me/${view}`,
        headers: as({ sub: STUDENT_A_ACCOUNT, email: FAMILY_EMAIL, roles: STUDENT_ROLE }),
      });
      expect(res.statusCode, view).toBe(200);
      const body = res.json() as { meta: { studentId: string } };
      expect(body.meta.studentId, view).toBe(SIBLING_A);
      expect(res.body, view).not.toContain(SIBLING_B);
    }
  });

  it('binds when the principal id is the students.id', async () => {
    app = await buildApp(siblings());
    const res = await app.inject({
      method: 'GET',
      url: '/student-portal/me/attendance',
      headers: as({ sub: SIBLING_B, email: FAMILY_EMAIL, roles: STUDENT_ROLE }),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { meta: { studentId: string } }).meta.studentId).toBe(SIBLING_B);
  });

  it('fails closed with 409 when one account is linked to two student records', async () => {
    app = await buildApp(
      siblings({ a: { userId: STUDENT_A_ACCOUNT }, b: { userId: STUDENT_A_ACCOUNT } }),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/student-portal/me/report-cards',
      headers: as({ sub: STUDENT_A_ACCOUNT, roles: STUDENT_ROLE }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.body).not.toContain(SIBLING_A);
    expect(res.body).not.toContain(SIBLING_B);
  });

  it('ignores links that exist only in another tenant or on deleted records', async () => {
    app = await buildApp([
      { id: SIBLING_A, tenantId: TENANT_B, userId: STUDENT_A_ACCOUNT },
      { id: SIBLING_B, tenantId: TENANT_A, userId: STUDENT_A_ACCOUNT, deleted: true },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/student-portal/me/attendance',
      headers: as({ sub: STUDENT_A_ACCOUNT, roles: STUDENT_ROLE }),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('selectBoundStudentId', () => {
  it('returns null for no candidates, the id for one, and throws ConflictError for many', () => {
    expect(selectBoundStudentId([])).toBeNull();
    expect(selectBoundStudentId([SIBLING_A, SIBLING_A])).toBe(SIBLING_A);
    expect(() => selectBoundStudentId([SIBLING_A, SIBLING_B])).toThrow(ConflictError);
  });
});

describe('PgAcademicVisibilityStore.resolveStudentId (PRC-H075)', () => {
  function fakePool(studentRows: Array<{ id: string }>) {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const pool = {
      query: async (sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        return { rows: /FROM students/.test(sql) ? studentRows : [] };
      },
    };
    return { pool, calls };
  }

  function studentsQuery(calls: Array<{ sql: string; values: unknown[] }>) {
    const call = calls.find((c) => /FROM students/.test(c.sql));
    expect(call).toBeDefined();
    return call!;
  }

  it('matches only on id / custom_data.user_id, never email or contacts, and has no LIMIT', async () => {
    const { pool, calls } = fakePool([{ id: SIBLING_A }]);
    const store = new PgAcademicVisibilityStore(pool as never);
    await expect(store.resolveStudentId(TENANT_A, STUDENT_A_ACCOUNT)).resolves.toBe(SIBLING_A);
    const { sql, values } = studentsQuery(calls);
    expect(sql).not.toMatch(/LIMIT/i);
    expect(sql).not.toMatch(/contacts/);
    expect(sql).not.toMatch(/email/);
    expect(sql).toMatch(/id::text = \$2/);
    expect(sql).toMatch(/custom_data @> jsonb_build_object\('user_id', \$2::text\)/);
    expect(values).toEqual([TENANT_A, STUDENT_A_ACCOUNT]);
  });

  it('throws ConflictError when more than one row is linked', async () => {
    const { pool } = fakePool([{ id: SIBLING_A }, { id: SIBLING_B }]);
    const store = new PgAcademicVisibilityStore(pool as never);
    await expect(store.resolveStudentId(TENANT_A, STUDENT_A_ACCOUNT)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('returns null when nothing is linked', async () => {
    const { pool } = fakePool([]);
    const store = new PgAcademicVisibilityStore(pool as never);
    await expect(store.resolveStudentId(TENANT_A, UNLINKED_ACCOUNT)).resolves.toBeNull();
  });
});
