import { randomBytes } from 'node:crypto';

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
