/**
 * PRC-L082 — grading-scheme names are unique per tenant, case-insensitively, on a real,
 * migrated Postgres (runtime app role, RLS enforced, Prisma repositories as in production).
 *
 * createGradingScheme checked findByName (case-insensitive) and then inserted, so two
 * concurrent creates of "Term" and "term" both landed. db/sql/269 adds
 * grading_schemes_tenant_lower_name_uidx (tenant_id, lower(name)); the Prisma repository
 * maps its unique violation (P2002 / 23505) to ConflictError (409).
 *
 * Fails closed when CI=true or REQUIRE_LIVE_TESTS=1 and DATABASE_URL is unset (W3-TEST-03).
 */
import { randomUUID } from 'node:crypto';
import { ConflictError } from '@proctira/common';
import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, describe, expect, it } from 'vitest';
import { AssessmentService } from './assessment-service.js';
import {
  PrismaAssessmentItemRepository,
  PrismaGradingSchemeRepository,
  PrismaOutcomeRepository,
} from './prisma-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'grading-scheme-name-unique.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
let prisma: PrismaClient | null = null;
function db(): PrismaClient {
  if (!prisma) prisma = createPrismaClient({ datasourceUrl: DATABASE_URL! });
  return prisma;
}

afterAll(async () => {
  await prisma?.$disconnect();
});

/** Holds every findByName caller until `parties` have looked (or 2 s pass): the race window. */
class BarrierSchemeRepository extends PrismaGradingSchemeRepository {
  private waiting: Array<() => void> = [];

  constructor(
    client: PrismaClient,
    private readonly parties: number,
  ) {
    super(client);
  }

  override async findByName(name: string, tenantId: string) {
    const found = await super.findByName(name, tenantId);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      this.waiting.push(() => {
        clearTimeout(timer);
        resolve();
      });
      if (this.waiting.length >= this.parties) {
        const all = this.waiting;
        this.waiting = [];
        all.forEach((go) => go());
      }
    });
    return found;
  }
}

const scheme = (name: string) => ({
  name,
  type: 'numeric' as const,
  minValue: 0,
  maxValue: 100,
  thresholds: [
    { grade: 'P', minScore: 50, maxScore: 100 },
    { grade: 'F', minScore: 0, maxScore: 49 },
  ],
});

describe.skipIf(!pool)('PRC-L082 grading-scheme name uniqueness (live)', () => {
  it('concurrent creates of "Term" and "term": one succeeds, one is a ConflictError', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const service = new AssessmentService(
      new BarrierSchemeRepository(db(), 2),
      new PrismaAssessmentItemRepository(db()),
      new PrismaOutcomeRepository(db()),
    );

    const results = await Promise.allSettled([
      service.createGradingScheme(tenantId, scheme('Term')),
      service.createGradingScheme(tenantId, scheme('term')),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected?.reason).toBeInstanceOf(ConflictError);
    const res = await withPgTenant(pool!, tenantId, (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM grading_schemes WHERE tenant_id = $1 AND lower(name) = 'term'`,
        [tenantId],
      ),
    );
    expect((res.rows[0] as { n: number }).n).toBe(1);
  });

  it('renaming onto an existing name (different case) past the service check is a ConflictError', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const repo = new PrismaGradingSchemeRepository(db());
    await repo.create({ id: randomUUID(), tenantId, ...scheme('Final') });
    const other = await repo.create({ id: randomUUID(), tenantId, ...scheme('Mid') });
    await expect(repo.update(other.id, tenantId, { name: 'FINAL' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('the same name in another tenant is allowed', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await ensurePgTestTenant(pool!, a);
    await ensurePgTestTenant(pool!, b);
    const repo = new PrismaGradingSchemeRepository(db());
    await repo.create({ id: randomUUID(), tenantId: a, ...scheme('Term') });
    await repo.create({ id: randomUUID(), tenantId: b, ...scheme('Term') });
  });
});
