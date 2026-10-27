/**
 * PRC-M335 — admissions enquiry concurrency on a real, migrated Postgres (runtime app
 * role, RLS enforced):
 * - convertEnquiry claims the enquiry (conditional UPDATE on application_id) before it
 *   creates the application, so concurrent conversions create exactly one
 *   admission_applications row.
 * - updateEnquiry is optimistic: the UPDATE carries `version = expected` (262), so a stale
 *   writer gets ConflictError instead of silently overwriting a newer edit.
 * - generateMeritList already serialises on the merit_lists ON CONFLICT row lock; two
 *   concurrent generations leave one list with one consistent entry set.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { ConflictError } from '@proctira/common';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgRegistrationRepository } from '../pg-registration-repository.js';
import { PgAdmissionsPipelineStore } from './pg-pipeline-store.js';
import { AdmissionsPipelineService } from './pipeline-service.js';

// Same contract as @proctira/testing requireLiveDatabaseUrl (not a dependency of this package).
const SUITE = 'enquiry-concurrency.live.test';
const DATABASE_URL = process.env['DATABASE_URL']?.trim() || undefined;
const liveRequired =
  process.env['ALLOW_LIVE_TEST_SKIP'] !== '1' &&
  (process.env['REQUIRE_LIVE_TESTS'] === '1' ||
    process.env['CI'] === 'true' ||
    process.env['CI'] === '1');
if (!DATABASE_URL && liveRequired) {
  throw new Error(`[W3-TEST-03] Live suite "${SUITE}" has no DATABASE_URL.`);
}
if (!DATABASE_URL) console.warn(`WARNING: [W3-TEST-03] ${SUITE} skipped (no DATABASE_URL).`);

describe.skipIf(!DATABASE_URL)('PRC-M335 enquiry concurrency (live)', () => {
  let pool: pg.Pool;
  let store: PgAdmissionsPipelineStore;
  let service: AdmissionsPipelineService;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 12 });
    store = new PgAdmissionsPipelineStore(pool);
    service = new AdmissionsPipelineService(store, new PgRegistrationRepository(pool));
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seed() {
    const tenantId = randomUUID();
    const gradeId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    await withPgTenant(pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO grades (id, tenant_id, name, code, "order") VALUES ($1, $2, 'Grade 1', $3, 1)`,
        [gradeId, tenantId, `G1-${gradeId.slice(0, 8)}`],
      );
    });
    return { tenantId, gradeId, institutionId: randomUUID(), academicPeriodId: randomUUID() };
  }

  async function newEnquiry(fx: Awaited<ReturnType<typeof seed>>, firstName = 'Asha') {
    return service.createEnquiry(fx.tenantId, {
      institutionId: fx.institutionId,
      academicPeriodId: fx.academicPeriodId,
      gradeId: fx.gradeId,
      firstName,
      lastName: 'Rao',
      dateOfBirth: '2018-04-01',
      guardianName: 'Guardian',
      guardianPhone: '+910000000000',
      interviewScore: 70,
      testScore: 80,
    });
  }

  async function countApplications(tenantId: string): Promise<number> {
    const res = await withPgTenant(pool, tenantId, (client) =>
      client.query(`SELECT count(*)::int AS n FROM admission_applications WHERE tenant_id = $1`, [
        tenantId,
      ]),
    );
    return (res.rows[0] as { n: number }).n;
  }

  it('five concurrent convertEnquiry calls create exactly one application', async () => {
    const fx = await seed();
    const enquiry = await newEnquiry(fx);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => service.convertEnquiry(fx.tenantId, enquiry.id)),
    );

    expect(await countApplications(fx.tenantId)).toBe(1);
    const stored = await store.findEnquiry(fx.tenantId, enquiry.id);
    expect(stored?.stage).toBe('applied');
    expect(stored?.applicationId).not.toBeNull();
    // Every caller that succeeded saw the same, single application.
    const appIds = new Set(
      results
        .filter((r) => r.status === 'fulfilled')
        .map((r) => (r as PromiseFulfilledResult<{ application: { id: string } }>).value)
        .map((v) => v.application.id),
    );
    expect([...appIds]).toEqual([stored?.applicationId]);
    // Callers that lost the race and could not observe the winner yet get 409, never a 500.
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ConflictError);
    }
  });

  it('a stale-version enquiry update is rejected with ConflictError', async () => {
    const fx = await seed();
    const created = await newEnquiry(fx);
    const original = await store.findEnquiry(fx.tenantId, created.id);
    expect(original).not.toBeNull();

    await service.updateEnquiry(fx.tenantId, created.id, { notes: 'newer edit' });

    await expect(
      store.updateEnquiry(
        { ...original!, notes: 'stale edit', updatedAt: new Date() },
        original!.version,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    const after = await store.findEnquiry(fx.tenantId, created.id);
    expect(after?.notes).toBe('newer edit');
  });

  it('two concurrent generateMeritList calls leave one list with one consistent entry set', async () => {
    const fx = await seed();
    for (const name of ['A', 'B', 'C']) {
      const enquiry = await newEnquiry(fx, name);
      await service.convertEnquiry(fx.tenantId, enquiry.id);
    }
    const input = {
      institutionId: fx.institutionId,
      academicPeriodId: fx.academicPeriodId,
      gradeId: fx.gradeId,
      interviewWeight: 0.5,
      testWeight: 0.5,
    };
    await Promise.all([
      service.generateMeritList(fx.tenantId, input),
      service.generateMeritList(fx.tenantId, input),
    ]);
    const res = await withPgTenant(pool, fx.tenantId, (client) =>
      client.query(
        `SELECT (SELECT count(*)::int FROM merit_lists WHERE tenant_id = $1) AS lists,
                (SELECT count(*)::int FROM merit_list_entries WHERE tenant_id = $1) AS entries,
                (SELECT count(DISTINCT application_id)::int FROM merit_list_entries
                  WHERE tenant_id = $1) AS apps`,
        [fx.tenantId],
      ),
    );
    expect(res.rows[0]).toEqual({ lists: 1, entries: 3, apps: 3 });
  });
});
