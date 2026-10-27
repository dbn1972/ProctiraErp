/**
 * PRC-M316 (failing-first): a Postgres 42703 (undefined_column) from any academic-read query
 * must never be swallowed as an empty, healthy-looking 200. A 42P01 (undefined_table) legitimately
 * stays empty-but-200, but is now observably flagged as `meta.source === 'degraded'` instead of
 * being indistinguishable from a genuinely-empty result.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  AcademicColumnMissingError,
  isAcademicColumnMissingError,
} from './academic-visibility-errors.js';
import { InMemoryParentPortalRepository } from './in-memory-repository.js';
import { parentPortalPlugin } from './parent-portal-plugin.js';
import { PgAcademicVisibilityStore } from './pg-academic-visibility-store.js';
import Fastify from 'fastify';

const TENANT_A = '00000000-0000-4000-8000-000000000001';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';

/** A pg-like pool whose `query` rejects for the matching SQL fragment with the given code. */
function fakePoolThrowingOn(matchFragment: string, code: string) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const pool = {
    query: async (sql: string, values: unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes(matchFragment)) {
        const error: Record<string, unknown> = new Error(`simulated pg error ${code}`);
        error.code = code;
        throw error;
      }
      return { rows: [] };
    },
  };
  return { pool, calls };
}

/**
 * Same as {@link fakePoolThrowingOn}, but also resolves `FROM students` to a bound student row
 * — needed for route-level tests that go through `resolveStudentId` before reaching the query
 * under test (`getSelfTimetable` etc. all self-bind first).
 */
function fakePoolBoundThrowingOn(studentId: string, matchFragment: string, code: string) {
  const pool = {
    query: async (sql: string) => {
      if (sql.includes(matchFragment)) {
        const error: Record<string, unknown> = new Error(`simulated pg error ${code}`);
        error.code = code;
        throw error;
      }
      if (sql.includes('FROM students')) return { rows: [{ id: studentId }] };
      return { rows: [] };
    },
  };
  return pool;
}

describe('PgAcademicVisibilityStore — 42703 handling (PRC-M316)', () => {
  it('a 42703 on the students lookup is never swallowed as an empty resolveStudentId result', async () => {
    const { pool } = fakePoolThrowingOn('FROM students', '42703');
    const store = new PgAcademicVisibilityStore(pool as never);

    // This is the behaviour the pre-fix code would have exhibited (swallow -> null, as if simply
    // unlinked). Asserting it explicitly here documents the bug this test guards against; the
    // real assertion below is the one that must hold post-fix.
    await expect(store.resolveStudentId(TENANT_A, STUDENT_ID)).rejects.toBeInstanceOf(
      AcademicColumnMissingError,
    );
  });

  it('a 42703 on getTimetable rejects with AcademicColumnMissingError, not an empty list', async () => {
    const { pool } = fakePoolThrowingOn('FROM section_enrollments', '42703');
    const store = new PgAcademicVisibilityStore(pool as never);
    await expect(store.getTimetable(TENANT_A, STUDENT_ID)).rejects.toSatisfy((error: unknown) =>
      isAcademicColumnMissingError(error),
    );
  });

  it('a 42703 on getAttendance (the enrollments/period lookup) rejects rather than returning empty', async () => {
    const { pool } = fakePoolThrowingOn('FROM enrollments', '42703');
    const store = new PgAcademicVisibilityStore(pool as never);
    await expect(store.getAttendance(TENANT_A, STUDENT_ID)).rejects.toBeInstanceOf(
      AcademicColumnMissingError,
    );
  });
});

describe('PgAcademicVisibilityStore — 42P01 degraded handling (PRC-M316)', () => {
  it('a 42P01 on getTimetable still resolves empty but tags meta.source as degraded and logs once', async () => {
    const { pool } = fakePoolThrowingOn('FROM section_enrollments', '42P01');
    const recordDegradedRead = vi.fn();
    const store = new PgAcademicVisibilityStore(pool as never, recordDegradedRead);

    const result = await store.getTimetable(TENANT_A, STUDENT_ID);

    expect(result.data).toEqual([]);
    expect(result.meta.source).toBe('degraded');
    expect(result.meta.degradedReason).toBe('relation_missing');
    expect(recordDegradedRead).toHaveBeenCalledTimes(1);
    expect(recordDegradedRead).toHaveBeenCalledWith('section_meetings', '42P01');
  });

  it('a genuinely-empty, healthy query still reports meta.source "none" (not degraded)', async () => {
    const pool = { query: async () => ({ rows: [] }) };
    const recordDegradedRead = vi.fn();
    const store = new PgAcademicVisibilityStore(pool as never, recordDegradedRead);

    const result = await store.getTimetable(TENANT_A, STUDENT_ID);

    expect(result.data).toEqual([]);
    expect(result.meta.source).toBe('none');
    expect(result.meta.degradedReason).toBeUndefined();
    expect(recordDegradedRead).not.toHaveBeenCalled();
  });
});

describe('route-level 42703 surfacing (PRC-M316)', () => {
  const TENANT = TENANT_A;
  const STUDENT_USER = STUDENT_ID;

  interface Principal {
    sub: string;
    roles: Array<{ roleId: string; roleName: string; areaId: string | null }>;
  }

  function buildApp(store: PgAcademicVisibilityStore) {
    const app = Fastify({ logger: false });
    app.decorateRequest('tenantId', '');
    app.decorateRequest('user', null as unknown as Principal);
    app.addHook('onRequest', async (request) => {
      const tenant = request.headers['x-tenant-id'];
      (request as unknown as { tenantId: string }).tenantId =
        typeof tenant === 'string' ? tenant : TENANT;
      const principal = request.headers['x-test-principal'];
      (request as unknown as { user: Principal | null }).user =
        typeof principal === 'string' ? (JSON.parse(principal) as Principal) : null;
    });
    return app;
  }

  it('a 42703 from the store surfaces as HTTP 503 with code ACADEMIC_COLUMN_MISSING', async () => {
    const pool = fakePoolBoundThrowingOn(STUDENT_USER, 'FROM section_enrollments', '42703');
    const store = new PgAcademicVisibilityStore(pool as never);
    const app = buildApp(store);
    await app.register(parentPortalPlugin, {
      repository: new InMemoryParentPortalRepository(),
      academicStore: store,
    });
    await app.ready();

    const res = await app.inject({
      method: 'GET',
      url: '/student-portal/me/timetable',
      headers: {
        'x-tenant-id': TENANT,
        'x-test-principal': JSON.stringify({
          sub: STUDENT_USER,
          roles: [{ roleId: 'student', roleName: 'Student', areaId: null }],
        }),
      },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: 'ACADEMIC_COLUMN_MISSING', statusCode: 503 });

    await app.close();
  });
});
