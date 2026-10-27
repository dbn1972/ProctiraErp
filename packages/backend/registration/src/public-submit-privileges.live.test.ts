/**
 * PRC-M568 blocker — public registration submit on a real, migrated Postgres as the
 * non-owner runtime role `proctira_app` (RLS forced, W1-DATA-11 privilege classes applied).
 *
 * `admission_form_configurations` is `append_only` for runtime (SELECT, INSERT). A row lock
 * clause naming that table (`FOR KEY SHARE OF ..., c`) needs UPDATE privilege, so
 * `createIdempotent` failed with 42501 `permission denied for table
 * admission_form_configurations` and the public submit returned HTTP 500.
 *
 * Proves, through the production repository and tenant binding (`withPgTenant`):
 * - a single submit persists with the exact config snapshot, replays, and detects payload reuse;
 * - concurrent submits with one idempotency key converge on exactly one application;
 * - the context-integrity guarantee the removed lock covered still holds (the submit holds a
 *   key-share lock on the exact config row until commit, configs are immutable, the
 *   validated composite FK exists, and unavailable contexts create nothing);
 * - tenant isolation: another tenant neither sees nor collides with the registration.
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 * The owner-only cases need MIGRATOR_DATABASE_URL and run in the live gate.
 */
import { createHash, randomUUID } from 'node:crypto';
import { bindTenantGuc, withPgTenant, type PgQueryable } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgRegistrationRepository, type PgPoolLike } from './pg-registration-repository.js';
import type { NewRegistrationEntity } from './registration-repository.js';
import { RegistrationService } from './registration-service.js';

// Same contract as @proctira/testing requireLiveDatabaseUrl (not a dependency of this package).
const SUITE = 'public-submit-privileges.live.test';
const DATABASE_URL = process.env['DATABASE_URL']?.trim() || undefined;
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL']?.trim() || undefined;
const liveRequired =
  process.env['ALLOW_LIVE_TEST_SKIP'] !== '1' &&
  (process.env['REQUIRE_LIVE_TESTS'] === '1' ||
    process.env['CI'] === 'true' ||
    process.env['CI'] === '1');
if (!DATABASE_URL && liveRequired) {
  throw new Error(`[W3-TEST-03] Live suite "${SUITE}" has no DATABASE_URL.`);
}
// MIGRATOR_DATABASE_URL is optional here, as in the sibling live suites: turbo's `test` task
// env allow-list does not pass it through, so the owner-only cases skip under
// `turbo run test` and execute in the W3-TEST-03 live gate (`pnpm test:live:gate`), which
// receives it directly and fails on any skipped test.
if (!DATABASE_URL) console.warn(`WARNING: [W3-TEST-03] ${SUITE} skipped (no DATABASE_URL).`);
if (DATABASE_URL && !MIGRATOR_DATABASE_URL) {
  console.warn(
    `WARNING: [W3-TEST-03] ${SUITE} owner-only cases skipped (no MIGRATOR_DATABASE_URL).`,
  );
}

const FORM_CONFIGURATION_FKEY = 'admission_applications_form_configuration_fkey';
const HOLD_TIMEOUT_MS = 10_000;

interface Fixture {
  tenantId: string;
  institutionId: string;
  configurationId: string;
}

function payloadHash(material: string): string {
  return createHash('sha256').update(material).digest('hex');
}

function trackingNumber(): string {
  return `REG-${randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function newEntity(
  fx: Fixture,
  overrides: Partial<NewRegistrationEntity> = {},
): NewRegistrationEntity {
  return {
    id: randomUUID(),
    tenantId: fx.tenantId,
    trackingNumber: trackingNumber(),
    institutionId: fx.institutionId,
    status: 'pending',
    firstName: 'Asha',
    lastName: 'Rao',
    dateOfBirth: '2018-04-01',
    gender: 'female',
    guardianName: 'Guardian',
    guardianPhone: '+910000000000',
    guardianEmail: null,
    customFields: [],
    documents: [],
    preferredLanguage: null,
    remarks: null,
    formConfigurationId: fx.configurationId,
    formConfigurationVersion: 1,
    submissionKey: `live-${randomUUID()}`,
    submissionPayloadHash: payloadHash('payload-a'),
    ...overrides,
  };
}

/** Run `fn` with the tenant bound in a transaction that is always rolled back. */
async function inTenantRollback<T>(
  pool: pg.Pool,
  tenantId: string,
  fn: (client: PgQueryable) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await bindTenantGuc(client, tenantId);
    return await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

/**
 * Pool wrapper that lets the test observe a submit transaction after its application INSERT
 * and hold its COMMIT open (bounded by HOLD_TIMEOUT_MS) until the test releases it.
 */
function holdingPool(base: pg.Pool) {
  let markInserted!: () => void;
  const inserted = new Promise<void>((resolve) => {
    markInserted = resolve;
  });
  let releaseCommit!: () => void;
  const commitReleased = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const pool = {
    query: base.query.bind(base),
    end: async () => undefined,
    connect: async () => {
      const client = await base.connect();
      let sawInsert = false;
      return {
        query: async (text: string, values?: unknown[]) => {
          if (sawInsert && text === 'COMMIT') {
            await Promise.race([
              commitReleased,
              new Promise((resolve) => setTimeout(resolve, HOLD_TIMEOUT_MS)),
            ]);
          }
          const result = await client.query(text, values);
          if (/INSERT INTO admission_applications/.test(text)) {
            sawInsert = true;
            markInserted();
          }
          return result;
        },
        release: () => client.release(),
      };
    },
  } as unknown as PgPoolLike;
  return { pool, inserted, releaseCommit };
}

describe.skipIf(!DATABASE_URL)('PRC-M568 public registration submit as proctira_app (live)', () => {
  let pool: pg.Pool;
  let ownerPool: pg.Pool | null = null;
  let repository: PgRegistrationRepository;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 12 });
    if (MIGRATOR_DATABASE_URL) {
      ownerPool = new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL, max: 2 });
    }
    repository = new PgRegistrationRepository(pool);
  });

  afterAll(async () => {
    await pool.end();
    await ownerPool?.end();
  });

  /** Tenant + area + active institution + published config v1, all written as proctira_app. */
  async function seed(): Promise<Fixture> {
    const fx: Fixture = {
      tenantId: randomUUID(),
      institutionId: randomUUID(),
      configurationId: randomUUID(),
    };
    const areaId = randomUUID();
    const suffix = fx.institutionId.slice(0, 8);
    await ensurePgTestTenant(pool, fx.tenantId);
    await withPgTenant(pool, fx.tenantId, async (client) => {
      await client.query(
        `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
         VALUES ($1, $2, 'Root', $3, 0, NULL, '/', 1, 2)`,
        [areaId, fx.tenantId, `ROOT-${suffix}`],
      );
      await client.query(
        `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
         VALUES ($1, $2, 'Live Submit School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
        [fx.institutionId, fx.tenantId, `REG-${suffix}`, areaId],
      );
      await client.query(
        `INSERT INTO admission_form_configurations
           (id, tenant_id, institution_id, version, fields, published_at)
         VALUES ($1, $2, $3, 1, '[]'::jsonb, now())`,
        [fx.configurationId, fx.tenantId, fx.institutionId],
      );
    });
    return fx;
  }

  async function countByKey(tenantId: string, submissionKey: string): Promise<number> {
    const res = await withPgTenant(pool, tenantId, (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM admission_applications
          WHERE tenant_id = $1 AND submission_key = $2`,
        [tenantId, submissionKey],
      ),
    );
    return (res.rows[0] as { n: number }).n;
  }

  async function countApplications(tenantId: string): Promise<number> {
    const res = await withPgTenant(pool, tenantId, (client) =>
      client.query(`SELECT count(*)::int AS n FROM admission_applications WHERE tenant_id = $1`, [
        tenantId,
      ]),
    );
    return (res.rows[0] as { n: number }).n;
  }

  describe('(a) single submit', () => {
    it('creates and persists the application with the exact config snapshot, then replays and detects payload reuse', async () => {
      const fx = await seed();
      const entity = newEntity(fx);

      const created = await repository.createIdempotent(entity);
      expect(created.outcome).toBe('created');
      if (created.outcome !== 'created') return;
      expect(created.registration.id).toBe(entity.id);

      const stored = await repository.findById(entity.id, fx.tenantId);
      expect(stored).not.toBeNull();
      expect(stored?.institutionName).toBe('Live Submit School');
      expect(stored?.formConfigurationId).toBe(fx.configurationId);
      expect(stored?.formConfigurationVersion).toBe(1);
      expect(stored?.submissionKey).toBe(entity.submissionKey);
      const configuration = await repository.getFormConfiguration(
        fx.tenantId,
        fx.institutionId,
        fx.configurationId,
      );
      expect(stored?.formConfigurationSnapshot).toEqual(configuration);

      const replay = await repository.createIdempotent({
        ...entity,
        id: randomUUID(),
        trackingNumber: trackingNumber(),
      });
      expect(replay).toMatchObject({ outcome: 'replayed', registration: { id: entity.id } });

      const conflict = await repository.createIdempotent({
        ...entity,
        id: randomUUID(),
        trackingNumber: trackingNumber(),
        submissionPayloadHash: payloadHash('payload-b'),
      });
      expect(conflict).toEqual({ outcome: 'payload_conflict' });
      expect(await countByKey(fx.tenantId, entity.submissionKey)).toBe(1);
    });

    it('RegistrationService.submitRegistration persists through the Pg repository and replays (no 500)', async () => {
      const fx = await seed();
      const service = new RegistrationService(repository);
      const key = `svc-${randomUUID()}`;
      const input = {
        institutionId: fx.institutionId,
        formConfigurationId: fx.configurationId,
        formConfigurationVersion: 1,
        firstName: 'Asha',
        lastName: 'Rao',
        dateOfBirth: '2018-04-01',
        gender: 'female',
        guardianName: 'Guardian',
        guardianPhone: '+910000000000',
      };

      const first = await service.submitRegistration(fx.tenantId, input, key);
      expect(first.replayed).toBe(false);
      expect(first.status).toBe('pending');
      const again = await service.submitRegistration(fx.tenantId, input, key);
      expect(again).toMatchObject({ replayed: true, id: first.id });
      expect(await countByKey(fx.tenantId, key)).toBe(1);
    });
  });

  describe('(b) concurrent submits with one idempotency key', () => {
    it('eight parallel same-payload submits yield exactly one created and consistent replays', async () => {
      const fx = await seed();
      const base = newEntity(fx);

      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          repository.createIdempotent({
            ...base,
            id: randomUUID(),
            trackingNumber: trackingNumber(),
          }),
        ),
      );

      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected.map((r) => (r as PromiseRejectedResult).reason)).toEqual([]);
      const outcomes = results.map(
        (r) =>
          (r as PromiseFulfilledResult<Awaited<ReturnType<typeof repository.createIdempotent>>>)
            .value,
      );
      const created = outcomes.filter((o) => o.outcome === 'created');
      expect(created).toHaveLength(1);
      const winnerId = created[0]!.outcome === 'created' ? created[0]!.registration.id : '';
      for (const o of outcomes) {
        if (o.outcome === 'created') continue;
        expect(o).toMatchObject({ outcome: 'replayed', registration: { id: winnerId } });
      }
      expect(await countByKey(fx.tenantId, base.submissionKey)).toBe(1);
    });

    it('four parallel submits with different payloads yield one created and the rest payload_conflict', async () => {
      const fx = await seed();
      const base = newEntity(fx);

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, (_, index) =>
          repository.createIdempotent({
            ...base,
            id: randomUUID(),
            trackingNumber: trackingNumber(),
            submissionPayloadHash: payloadHash(`payload-${index}`),
          }),
        ),
      );

      const rejected = results.filter((r) => r.status === 'rejected');
      expect(rejected.map((r) => (r as PromiseRejectedResult).reason)).toEqual([]);
      const outcomes = results.map(
        (r) =>
          (r as PromiseFulfilledResult<Awaited<ReturnType<typeof repository.createIdempotent>>>)
            .value.outcome,
      );
      expect(outcomes.filter((o) => o === 'created')).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'payload_conflict')).toHaveLength(3);
      expect(await countByKey(fx.tenantId, base.submissionKey)).toBe(1);
    });
  });

  describe('(c) the race the config row lock protected against', () => {
    it.skipIf(!MIGRATOR_DATABASE_URL)(
      'an in-flight submit holds a key-share lock on the exact config row and on the institution until commit',
      async () => {
        const fx = await seed();
        const holder = holdingPool(pool);
        const heldRepository = new PgRegistrationRepository(holder.pool);
        const lockConfig = (client: PgQueryable) =>
          client.query(
            `SELECT 1 FROM admission_form_configurations
              WHERE tenant_id = $1 AND id = $2 FOR UPDATE NOWAIT`,
            [fx.tenantId, fx.configurationId],
          );
        const lockInstitution = (client: PgQueryable) =>
          client.query(
            `SELECT 1 FROM institutions WHERE tenant_id = $1 AND id = $2 FOR UPDATE NOWAIT`,
            [fx.tenantId, fx.institutionId],
          );

        const submit = heldRepository.createIdempotent(newEntity(fx));
        try {
          // Rejects with the submit's own error if it fails before reaching the INSERT.
          await Promise.race([holder.inserted, submit]);
          // Owner (FORCE RLS → tenant bound): config row delete/key-change is blocked.
          await expect(inTenantRollback(ownerPool!, fx.tenantId, lockConfig)).rejects.toMatchObject(
            { code: '55P03' },
          );
          // Runtime: institution hard-delete/key-change is blocked (OF i lock retained).
          await expect(inTenantRollback(pool, fx.tenantId, lockInstitution)).rejects.toMatchObject({
            code: '55P03',
          });
        } finally {
          holder.releaseCommit();
        }
        expect((await submit).outcome).toBe('created');
        // Lock released at commit.
        const after = await inTenantRollback(ownerPool!, fx.tenantId, lockConfig);
        expect(after.rows).toHaveLength(1);
      },
    );

    it.skipIf(!MIGRATOR_DATABASE_URL)(
      'published configurations are immutable for runtime (no privilege) and owner (append-only trigger)',
      async () => {
        const fx = await seed();
        const update = (client: PgQueryable) =>
          client.query(
            `UPDATE admission_form_configurations SET version = 9
              WHERE tenant_id = $1 AND id = $2`,
            [fx.tenantId, fx.configurationId],
          );
        const remove = (client: PgQueryable) =>
          client.query(
            `DELETE FROM admission_form_configurations WHERE tenant_id = $1 AND id = $2`,
            [fx.tenantId, fx.configurationId],
          );

        await expect(withPgTenant(pool, fx.tenantId, update)).rejects.toMatchObject({
          code: '42501',
        });
        await expect(withPgTenant(pool, fx.tenantId, remove)).rejects.toMatchObject({
          code: '42501',
        });
        await expect(withPgTenant(ownerPool!, fx.tenantId, update)).rejects.toMatchObject({
          code: '23000',
        });
        await expect(withPgTenant(ownerPool!, fx.tenantId, remove)).rejects.toMatchObject({
          code: '23000',
        });

        const configuration = await repository.getFormConfiguration(
          fx.tenantId,
          fx.institutionId,
          fx.configurationId,
        );
        expect(configuration).toMatchObject({ id: fx.configurationId, version: 1, fields: [] });
      },
    );

    it('unavailable contexts (unpublished version, inactive institution) return context_unavailable and create nothing', async () => {
      const fx = await seed();

      const unpublished = await repository.createIdempotent(
        newEntity(fx, { formConfigurationVersion: 2 }),
      );
      expect(unpublished).toEqual({ outcome: 'context_unavailable' });

      await withPgTenant(pool, fx.tenantId, (client) =>
        client.query(
          `UPDATE institutions SET status = 'inactive' WHERE tenant_id = $1 AND id = $2`,
          [fx.tenantId, fx.institutionId],
        ),
      );
      const inactive = await repository.createIdempotent(newEntity(fx));
      expect(inactive).toEqual({ outcome: 'context_unavailable' });

      expect(await countApplications(fx.tenantId)).toBe(0);
    });

    it('the composite tenant/config/institution/version FK exists and is validated', async () => {
      const res = await pool.query(
        `SELECT convalidated FROM pg_constraint
          WHERE conrelid = 'public.admission_applications'::regclass AND conname = $1`,
        [FORM_CONFIGURATION_FKEY],
      );
      expect(res.rows).toEqual([{ convalidated: true }]);
    });
  });

  describe('(d) tenant isolation', () => {
    it('another tenant cannot see, collide with, or submit against the registration', async () => {
      const a = await seed();
      const b = await seed();
      const entityA = newEntity(a);

      const createdA = await repository.createIdempotent(entityA);
      expect(createdA.outcome).toBe('created');

      // Same idempotency key in tenant B is an independent submission, not a replay of A.
      const entityB = newEntity(b, { submissionKey: entityA.submissionKey });
      const createdB = await repository.createIdempotent(entityB);
      expect(createdB).toMatchObject({ outcome: 'created', registration: { id: entityB.id } });

      // Tenant B cannot read tenant A's registration.
      expect(await repository.findById(entityA.id, b.tenantId)).toBeNull();
      expect(await repository.findByTrackingNumber(entityA.trackingNumber, b.tenantId)).toBeNull();

      // Tenant B cannot submit against tenant A's institution/config (RLS hides the context).
      const crossTenant = await repository.createIdempotent(
        newEntity(a, { tenantId: b.tenantId, submissionKey: `cross-${randomUUID()}` }),
      );
      expect(crossTenant).toEqual({ outcome: 'context_unavailable' });

      expect(await countByKey(a.tenantId, entityA.submissionKey)).toBe(1);
      expect(await countByKey(b.tenantId, entityA.submissionKey)).toBe(1);
      expect(await countApplications(a.tenantId)).toBe(1);
      expect(await countApplications(b.tenantId)).toBe(1);
      expect(await repository.findById(entityA.id, a.tenantId)).toMatchObject({
        tenantId: a.tenantId,
        submissionKey: entityA.submissionKey,
      });
    });
  });
});
