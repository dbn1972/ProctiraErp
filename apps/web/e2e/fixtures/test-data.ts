import { randomBytes } from 'node:crypto';

import type { APIRequestContext } from '@playwright/test';

/**
 * Generates a unique student-name suffix so that concurrent test runs don't
 * collide on uniqueness constraints in the backend.
 */
export function uniqueSuffix(): string {
  return randomBytes(4).toString('hex');
}

/**
 * Generates a unique grade `order` within the Postgres `smallint` range
 * (`1..32767`).
 *
 * PRC-M280 made grade `order` unique per tenant (a duplicate order collapses
 * two grades into one rollover slot). Live E2E specs share one TENANT_A against
 * a per-run Postgres, and several specs/tests create a throwaway grade, so a
 * hard-coded `order` collides with `409 CONFLICT`. Draw a high-entropy value
 * (mirroring {@link uniqueSuffix}) so concurrent shards and repeated tests do
 * not clash; the rare collision self-heals on Playwright's test retry, which
 * re-runs the fixture and redraws. No spec asserts on the order value itself —
 * only that creation succeeds and tenant isolation holds.
 */
export function uniqueGradeOrder(): number {
  // 2 random bytes → 0..65535; map into 1..32767 (smallint, non-zero).
  return (randomBytes(2).readUInt16BE(0) % 32767) + 1;
}

/**
 * Draws a random one-year (April–March) window far enough in the future
 * that it can never overlap the 2026 baseline seeded year
 * (tools/e2e/seed-e2e-tenants.sql) or the shared "current" year from
 * {@link ensureSharedAcademicYear}.
 *
 * Several specs each need their OWN distinct, not-shared academic year (e.g.
 * to test creation/rollover/hierarchy behavior in isolation) rather than
 * reusing the one shared "current" year. Before PRC-L122's per-tenant
 * overlap guard, hardcoding a fixed future window (e.g. 2038-04-01..
 * 2039-03-31) was safe since nothing checked for collisions. With the guard
 * live, two specs sharing one tenant that both hardcode the SAME window
 * collide with each other, and a spec calling its own helper more than once
 * per run collides with itself.
 *
 * Mirrors {@link uniqueGradeOrder}'s approach to the identical class of
 * problem: draw from a wide enough space that a real collision is
 * vanishingly unlikely, and let a rare one self-heal on Playwright's retry
 * rather than coordinating shared state across every caller.
 */
export function uniqueFarFutureYearWindow(): { startDate: string; endDate: string } {
  // 2040..2099: 60 candidate years, nowhere near the 2026 baseline/shared
  // year or 2030-2036 range already used by 38-academic-calendar-write-smoke.
  const year = 2040 + (randomBytes(1).readUInt8(0) % 60);
  return { startDate: `${year}-04-01`, endDate: `${year + 1}-03-31` };
}

export interface TestStudent {
  firstName: string;
  lastName: string;
  fullName: string;
  dateOfBirth: string; // ISO yyyy-mm-dd
  gender: 'Male' | 'Female';
}

export function makeTestStudent(prefix = 'E2E'): TestStudent {
  const suffix = uniqueSuffix();
  const firstName = `${prefix}First${suffix}`;
  const lastName = `${prefix}Last${suffix}`;
  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
    dateOfBirth: '2010-05-15',
    gender: 'Female',
  };
}

export interface SeedConfig {
  /**
   * Base URL of the API gateway. When unset the seeder no-ops so tests can run
   * against pre-seeded fixtures.
   */
  gatewayUrl?: string;
  tenantSubdomain?: string;
  authToken?: string;
}

/**
 * Gets-or-creates the single tenant-wide "current" academic year shared by
 * every live-gated E2E spec.
 *
 * PRC-L122 made academic-year windows overlap-checked at the `tenantId`
 * level (`AcademicPeriod` has no per-institution scoping column — years are
 * tenant-wide by design). Before that guard shipped, every spec safely
 * created its own throwaway "current year" fixture with a now-centered
 * window (`isoDate(-30)..isoDate(300)`, etc.) because nothing checked for
 * collisions. All of those windows span "today" by construction, so with the
 * guard live the first spec to run against the shared E2E tenant wins and
 * every later spec's create call 409s.
 *
 * Mirrors {@link uniqueGradeOrder}'s approach to the same class of problem
 * (specs sharing one tenant against one per-run Postgres) but inverted:
 * `order` values are cheap to make non-colliding by drawing wider, so each
 * spec keeps creating its own; academic years are a single tenant-wide
 * concept by design, so the fix is to share one instead of avoiding overlap.
 *
 * Idempotent and race-tolerant: a list-then-create-on-miss has an inherent
 * TOCTOU gap when specs run in parallel shards, so a losing create's 409 is
 * treated as "another spec already created it" and resolved by re-fetching
 * rather than failing — the same self-heals-on-retry posture already
 * documented on {@link uniqueGradeOrder}.
 */
export async function ensureSharedAcademicYear(
  request: APIRequestContext,
  gatewayUrl: string,
  headers: Record<string, string>,
): Promise<{ id: string; startDate: string; endDate: string }> {
  const list = await request.get(`${gatewayUrl}/api/v1/academic-periods?kind=year`, { headers });
  if (list.ok()) {
    const years = (await list.json()) as Array<{
      id: string;
      startDate: string;
      endDate: string;
    }>;
    const [first] = years;
    if (first) {
      return { id: first.id, startDate: first.startDate, endDate: first.endDate };
    }
  }

  const suffix = uniqueSuffix();
  const create = await request.post(`${gatewayUrl}/api/v1/academic-periods`, {
    headers,
    data: {
      name: `E2E Shared Year ${suffix}`,
      code: `E2E-SHARED-AY-${suffix}`,
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      status: 'active',
    },
  });

  if (create.status() === 201) {
    const body = (await create.json()) as { id: string; startDate: string; endDate: string };
    return { id: body.id, startDate: body.startDate, endDate: body.endDate };
  }

  if (create.status() === 409) {
    // Another spec/shard won the create race (code collision or the
    // PRC-L122 overlap guard firing against a year created concurrently).
    // Re-fetch rather than failing — the loser just needs the winner's row.
    const retry = await request.get(`${gatewayUrl}/api/v1/academic-periods?kind=year`, {
      headers,
    });
    if (retry.ok()) {
      const years = (await retry.json()) as Array<{
        id: string;
        startDate: string;
        endDate: string;
      }>;
      const [first] = years;
      if (first) {
        return { id: first.id, startDate: first.startDate, endDate: first.endDate };
      }
    }
  }

  throw new Error(
    `ensureSharedAcademicYear: create failed (${create.status()}): ${await create.text()}`,
  );
}

/**
 * Posts setup data through the backend gateway when configured. When the
 * gateway URL is missing this is a no-op and the test relies on pre-seeded
 * data from the demo backend.
 */
export async function seedTestData(config: SeedConfig = {}): Promise<void> {
  const gatewayUrl =
    config.gatewayUrl ?? process.env.E2E_GATEWAY_URL ?? process.env.API_GATEWAY_URL;
  if (!gatewayUrl) {
    // eslint-disable-next-line no-console
    console.warn(
      '[e2e] seedTestData: no gateway URL configured (set E2E_GATEWAY_URL); skipping seeding',
    );
    return;
  }

  const tenant = config.tenantSubdomain ?? process.env.E2E_TENANT_A_SUBDOMAIN ?? 'tenant-a';
  const token = config.authToken ?? process.env.E2E_SEED_TOKEN;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Tenant': tenant,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Best-effort seeding: ping the gateway to confirm reachability. Detailed
  // setup data is environment-specific and lives in the demo backend's seed
  // scripts; this hook only verifies the gateway is up before the suite runs.
  try {
    const response = await fetch(`${gatewayUrl.replace(/\/$/, '')}/health`, { headers });
    if (!response.ok) {
      // eslint-disable-next-line no-console
      console.warn(`[e2e] seedTestData: gateway health check returned ${response.status}`);
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn('[e2e] seedTestData: gateway unreachable, continuing', error);
  }
}
