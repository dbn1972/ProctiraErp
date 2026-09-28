/**
 * Unit tests for `loadDashboardAggregates`'s four new principal metrics
 * (principal-dashboard-parity spec, Task 2.6 — Requirements 4.7, 4.8, 7.3):
 *   - todayAttendancePercent
 *   - feeCollectedThisMonthCents
 *   - pendingAdmissionsCount
 *   - openHealthIncidentsCount
 *
 * Covers:
 *   1. The demo-fallback branch (no DATABASE_URL) — real, unmocked behavior.
 *   2. Each new field's `relationExists()`-false guarded default.
 *   3. A happy path where the relations exist and real rows are returned.
 *
 * Also covers the optional Redis read-through cache wrapper added around
 * `loadDashboardAggregates` (Task 2.7 — Requirements 7.1, 7.2), in the
 * "Redis cache wrapper" describe block below (Task 2.8):
 *   4. `cache` omitted — unchanged direct-query behavior (see note there;
 *      already exercised by the suites above, which never pass a `cache`).
 *   5. Cache hit — the underlying pool is never touched.
 *   6. Cache miss — the delegate runs once and the result is cached.
 *   7. Redis-throws — `CacheClient` swallows the error and falls through to
 *      the real query instead of throwing.
 *
 * `getSharedPgPool` is mocked so tests can inject a fake connectable pool
 * without depending on a live Postgres instance; `withPgTenant` and every
 * other export stay real, mirroring the fake-pool shape in
 * `packages/shared/database/src/pg-tenant.test.ts` and the
 * `vi.mock('@proctira/database', ...)` style used by
 * `packages/backend/health/src/phi-write-txn-audit.test.ts`.
 *
 * The `CacheClient` fakes below mirror the `createJsonRoundTripCache()`
 * pattern in `packages/backend/institution/src/cached-institution-repository.test.ts`
 * and `packages/backend/workflow/src/cached-workflow-repository.test.ts`: a
 * real `CacheClient` constructed over a minimal fake ioredis-like object, so
 * `CacheClient`'s own get/set/error-handling logic runs for real and only
 * the network boundary is faked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CacheClient, tenantKey } from '@proctira/cache';

import { loadDashboardAggregates, type DashboardAggregates } from './dashboards.js';

const fakePoolState = vi.hoisted(() => ({
  pool: null as unknown,
}));

vi.mock('@proctira/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@proctira/database')>();
  return {
    ...actual,
    getSharedPgPool: (databaseUrl?: string) => {
      if (fakePoolState.pool) {
        return fakePoolState.pool as ReturnType<typeof actual.getSharedPgPool>;
      }
      return actual.getSharedPgPool(databaseUrl);
    },
  };
});

const TENANT_ID = '33333333-3333-4333-8333-333333333333';

interface FakeCounts {
  schools?: number;
  students?: number;
  enrolments?: number;
  presentAllTime?: number;
  totalAllTime?: number;
  presentToday?: number;
  totalToday?: number;
  openInvoices?: number;
  feesCollectedCents?: number;
  feeCollectedThisMonthCents?: number;
  linkedChildren?: number;
  pendingAdmissionsCount?: number;
  openHealthIncidentsCount?: number;
}

/** Fake `PgClient` whose `query()` answers `to_regclass` and `COUNT`/`SUM` queries from fixtures. */
function makeFakeClient(existing: Set<string>, counts: FakeCounts) {
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [] };
    }
    if (text.includes('set_config(')) {
      return { rows: [] }; // bindTenantGuc (BIND_TENANT_GUC_SQL)
    }
    if (text.startsWith('SELECT to_regclass')) {
      const requested = String(values?.[0] ?? '').replace(/^public\./, '');
      return { rows: [{ reg: existing.has(requested) ? requested : null }] };
    }

    // student_attendance backs both the existing attendancePercent field and
    // the new todayAttendancePercent field; disambiguate by clause, checking
    // the most qualified WHERE clause first since each query text is a
    // superstring of the ones below it.
    if (text.includes('FROM student_attendance')) {
      if (text.includes('CURRENT_DATE') && text.includes('status IN')) {
        return { rows: [{ n: counts.presentToday ?? 0 }] };
      }
      if (text.includes('CURRENT_DATE')) {
        return { rows: [{ n: counts.totalToday ?? 0 }] };
      }
      if (text.includes('status IN')) {
        return { rows: [{ n: counts.presentAllTime ?? 0 }] };
      }
      return { rows: [{ n: counts.totalAllTime ?? 0 }] };
    }
    if (text.includes('FROM institutions')) {
      return { rows: [{ n: counts.schools ?? 0 }] };
    }
    if (text.includes('FROM students')) {
      return { rows: [{ n: counts.students ?? 0 }] };
    }
    if (text.includes('FROM enrollments')) {
      return { rows: [{ n: counts.enrolments ?? 0 }] };
    }
    if (text.includes('FROM parent_fee_invoices')) {
      return { rows: [{ n: counts.openInvoices ?? 0 }] };
    }
    if (text.includes('FROM parent_fee_payments')) {
      return {
        rows: [
          {
            n: text.includes('date_trunc')
              ? counts.feeCollectedThisMonthCents ?? 0
              : counts.feesCollectedCents ?? 0,
          },
        ],
      };
    }
    if (text.includes('FROM parent_child_links')) {
      return { rows: [{ n: counts.linkedChildren ?? 0 }] };
    }
    if (text.includes('FROM admission_applications')) {
      return { rows: [{ n: counts.pendingAdmissionsCount ?? 0 }] };
    }
    if (text.includes('FROM health_nurse_incidents')) {
      return { rows: [{ n: counts.openHealthIncidentsCount ?? 0 }] };
    }
    return { rows: [{ n: 0 }] };
  });

  return { query, release: vi.fn() };
}

/** Fake connectable pool: `withPgTenant` takes the BEGIN/bindTenantGuc/COMMIT path. */
function makeFakePool(existing: string[], counts: FakeCounts = {}) {
  const client = makeFakeClient(new Set(existing), counts);
  return { query: vi.fn(), connect: vi.fn(async () => client) };
}

afterEach(() => {
  fakePoolState.pool = null;
  vi.unstubAllEnvs();
});

describe('loadDashboardAggregates — demo fallback (no DATABASE_URL)', () => {
  it('returns demo aggregates with all four new fields populated', async () => {
    vi.stubEnv('DATABASE_URL', '');

    const result = await loadDashboardAggregates(TENANT_ID);

    // Pinned to dashboards.ts's DEMO_AGGREGATES constants: demo/offline mode
    // must always show sensible, non-null values on every principal card.
    expect(result.todayAttendancePercent).toBe(94.2);
    expect(result.feeCollectedThisMonthCents).toBe(420_000);
    expect(result.pendingAdmissionsCount).toBe(5);
    expect(result.openHealthIncidentsCount).toBe(2);

    expect(result.todayAttendancePercent).not.toBeNull();
    expect(Number.isFinite(result.feeCollectedThisMonthCents)).toBe(true);
    expect(Number.isFinite(result.pendingAdmissionsCount)).toBe(true);
    expect(Number.isFinite(result.openHealthIncidentsCount)).toBe(true);

    // Existing fields are untouched by the addition of the four new ones.
    expect(result.schools).toBeGreaterThan(0);
    expect(result.attendancePercent).toBe(94.2);
  });
});

describe('loadDashboardAggregates — relationExists() false yields guarded defaults', () => {
  // `institutions` stays present in every case so `schools > 0`, which keeps
  // loadDashboardAggregates's own "everything is zero" shortcut
  // (`schools + students + enrolments + openInvoices === 0 && attendancePercent
  // == null`) from firing and substituting DEMO_AGGREGATES — that shortcut
  // would mask the guarded per-field default this suite is testing.

  it('todayAttendancePercent defaults to null when student_attendance is absent', async () => {
    fakePoolState.pool = makeFakePool(['institutions'], { schools: 5 });

    const result = await loadDashboardAggregates(TENANT_ID);

    expect(result.todayAttendancePercent).toBeNull();
  });

  it('feeCollectedThisMonthCents defaults to 0 when parent_fee_payments is absent', async () => {
    fakePoolState.pool = makeFakePool(['institutions'], { schools: 5 });

    const result = await loadDashboardAggregates(TENANT_ID);

    expect(result.feeCollectedThisMonthCents).toBe(0);
  });

  it('pendingAdmissionsCount defaults to 0 when admission_applications is absent', async () => {
    fakePoolState.pool = makeFakePool(['institutions'], { schools: 5 });

    const result = await loadDashboardAggregates(TENANT_ID);

    expect(result.pendingAdmissionsCount).toBe(0);
  });

  it('openHealthIncidentsCount defaults to 0 when health_nurse_incidents is absent', async () => {
    fakePoolState.pool = makeFakePool(['institutions'], { schools: 5 });

    const result = await loadDashboardAggregates(TENANT_ID);

    expect(result.openHealthIncidentsCount).toBe(0);
  });
});

describe('loadDashboardAggregates — happy path with real rows', () => {
  it('computes todayAttendancePercent and pendingAdmissionsCount from real query rows', async () => {
    fakePoolState.pool = makeFakePool(
      ['institutions', 'student_attendance', 'admission_applications'],
      {
        schools: 5,
        // 41/53 = 77.358...% — deliberately not a round number, so this also
        // proves the Math.round(x * 1000) / 10 one-decimal rounding rule
        // (the same rule the existing attendancePercent field uses).
        presentToday: 41,
        totalToday: 53,
        pendingAdmissionsCount: 7,
      },
    );

    const result = await loadDashboardAggregates(TENANT_ID);

    expect(result.todayAttendancePercent).toBe(77.4);
    expect(result.pendingAdmissionsCount).toBe(7);
  });
});

describe('loadDashboardAggregates — Redis cache wrapper (Task 2.8, Requirements 7.1, 7.2)', () => {
  const CACHE_KEY = tenantKey(TENANT_ID, 'dashboard-aggregates', 'principal');

  /**
   * Real `CacheClient` over a minimal fake ioredis-like object, following
   * the `createJsonRoundTripCache()` pattern in
   * `packages/backend/institution/src/cached-institution-repository.test.ts`
   * and `packages/backend/workflow/src/cached-workflow-repository.test.ts`.
   * `CacheClient`'s own get/set/getOrSet logic runs unmodified; only the
   * network boundary (a real Redis connection) is faked.
   */
  function createFakeRedisCache(): { cache: CacheClient; store: Map<string, string> } {
    const store = new Map<string, string>();
    const mockRedis = {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (...keys: string[]) => {
        let count = 0;
        for (const key of keys) {
          if (store.delete(key)) count++;
        }
        return count;
      }),
      scan: vi.fn(async () => ['0', []] as [string, string[]]),
      ping: vi.fn(async () => 'PONG'),
      quit: vi.fn(async () => 'OK'),
    };
    const cache = new CacheClient({ redis: mockRedis as unknown as import('ioredis').default });
    return { cache, store };
  }

  /**
   * A `CacheClient` whose underlying Redis calls all reject. Per
   * `CacheClient.getOrSet`'s documented contract
   * (`packages/shared/cache/src/cache-client.ts`): `get()` catches the
   * error, increments the error metric, and returns `null`; `getOrSet`
   * then treats that as a miss and falls through to the fetcher; `set()`
   * likewise catches and swallows its own error. Nothing here should ever
   * throw or reject out to the caller.
   */
  function createBrokenRedisCache(): CacheClient {
    const redisError = () => Promise.reject(new Error('ECONNREFUSED: Redis unavailable'));
    const mockRedis = {
      get: vi.fn(redisError),
      set: vi.fn(redisError),
      del: vi.fn(redisError),
      scan: vi.fn(redisError),
      ping: vi.fn(redisError),
      quit: vi.fn(async () => 'OK'),
    };
    return new CacheClient({ redis: mockRedis as unknown as import('ioredis').default });
  }

  it('cache omitted: runs the direct query with no CacheClient involved (already exercised throughout this file; confirmed once more here alongside the other three cache-wrapper cases for discoverability)', async () => {
    fakePoolState.pool = makeFakePool(['institutions'], { schools: 9 });

    const result = await loadDashboardAggregates(TENANT_ID);

    expect(result.schools).toBe(9);
  });

  it('cache hit: returns the cached value and never touches the underlying pool', async () => {
    const { cache, store } = createFakeRedisCache();
    const cachedValue: DashboardAggregates = {
      schools: 111,
      students: 222,
      enrolments: 333,
      attendancePercent: 44.4,
      openInvoices: 5,
      feesCollectedCents: 666,
      linkedChildren: 7,
      todayAttendancePercent: 88.8,
      feeCollectedThisMonthCents: 999,
      pendingAdmissionsCount: 10,
      openHealthIncidentsCount: 11,
    };
    store.set(CACHE_KEY, JSON.stringify(cachedValue));

    // Deliberately explosive pool: if the cache hit didn't short-circuit and
    // the code fell through to the real query, this surfaces loudly rather
    // than silently returning a plausible-looking wrong value.
    const explosivePool = {
      query: vi.fn(async () => {
        throw new Error('BUG: pool.query must not run on a cache hit');
      }),
      connect: vi.fn(async () => {
        throw new Error('BUG: pool.connect must not run on a cache hit');
      }),
    };
    fakePoolState.pool = explosivePool;

    const result = await loadDashboardAggregates(TENANT_ID, cache);

    expect(result).toEqual(cachedValue);
    expect(explosivePool.connect).not.toHaveBeenCalled();
    expect(explosivePool.query).not.toHaveBeenCalled();
  });

  it('cache miss: calls the delegate once, returns its computed result, and leaves it cached afterward', async () => {
    const { cache, store } = createFakeRedisCache();
    const pool = makeFakePool(
      [
        'institutions',
        'students',
        'enrollments',
        'student_attendance',
        'parent_fee_invoices',
        'parent_fee_payments',
        'parent_child_links',
        'admission_applications',
        'health_nurse_incidents',
      ],
      {
        schools: 5,
        students: 61,
        enrolments: 40,
        presentAllTime: 80,
        totalAllTime: 100,
        presentToday: 41,
        totalToday: 53,
        openInvoices: 6,
        feesCollectedCents: 500_000,
        feeCollectedThisMonthCents: 12_345,
        linkedChildren: 9,
        pendingAdmissionsCount: 7,
        openHealthIncidentsCount: 3,
      },
    );
    fakePoolState.pool = pool;

    // What an uncached `computeAggregates(tenantId)` produces from this same
    // fixture (cross-checked against the "happy path" suite above, which
    // uses the same 41/53 attendance figures for todayAttendancePercent).
    const expected: DashboardAggregates = {
      schools: 5,
      students: 61,
      enrolments: 40,
      attendancePercent: 80,
      openInvoices: 6,
      feesCollectedCents: 500_000,
      linkedChildren: 9,
      todayAttendancePercent: 77.4,
      feeCollectedThisMonthCents: 12_345,
      pendingAdmissionsCount: 7,
      openHealthIncidentsCount: 3,
    };

    const result = await loadDashboardAggregates(TENANT_ID, cache);

    expect(result).toEqual(expected);
    expect(pool.connect).toHaveBeenCalledTimes(1);

    // `CacheClient.getOrSet`'s cache write is fire-and-forget
    // (`void this.set(...)`); give its microtask a tick to land before
    // asserting the cache now holds the computed value, mirroring
    // `packages/shared/cache/src/__tests__/cache-client.test.ts`.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(store.get(CACHE_KEY)).toBe(JSON.stringify(expected));
    await expect(cache.get(CACHE_KEY)).resolves.toEqual(expected);
  });

  it('Redis-throws: falls through to the real query and resolves correctly instead of throwing', async () => {
    const brokenCache = createBrokenRedisCache();
    const pool = makeFakePool(['institutions', 'student_attendance'], {
      schools: 8,
      presentToday: 10,
      totalToday: 20,
    });
    fakePoolState.pool = pool;

    // `resolves.toEqual` fails the test if the returned promise rejects, so
    // this proves both that `loadDashboardAggregates` does not throw when
    // every Redis call fails, and that it still falls through to a correct
    // result rather than silently degrading to DEMO_AGGREGATES.
    await expect(loadDashboardAggregates(TENANT_ID, brokenCache)).resolves.toEqual({
      schools: 8,
      students: 0,
      enrolments: 0,
      attendancePercent: null,
      openInvoices: 0,
      feesCollectedCents: 0,
      linkedChildren: 0,
      todayAttendancePercent: 50,
      feeCollectedThisMonthCents: 0,
      pendingAdmissionsCount: 0,
      openHealthIncidentsCount: 0,
    });

    // Confirms the fallback genuinely reached the real query path exactly
    // once, rather than short-circuiting some other way.
    expect(pool.connect).toHaveBeenCalledTimes(1);
  });
});
