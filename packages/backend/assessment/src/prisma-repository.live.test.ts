/**
 * PRC-M583 — live two-tenant isolation proof for the Prisma assessment
 * repositories selected in production when DATABASE_URL is set
 * (repository-factory.ts): grading schemes, assessment items, outcomes and
 * results. Tenant B must never read, list, update or delete tenant A's rows.
 *
 * Skips without DATABASE_URL; CI `test:live:gate` runs it with REQUIRE_LIVE_TESTS=1.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient, getSharedPgPool } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, describe, expect, it } from 'vitest';

import {
  PrismaAssessmentItemRepository,
  PrismaGradingSchemeRepository,
  PrismaOutcomeRepository,
} from './prisma-repository.js';
import { PrismaAssessmentResultRepository } from './prisma-result-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'prisma-repository.live.test' });
const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
const live = Boolean(DATABASE_URL) && pool !== null;

let prisma: PrismaClient | null = null;
function sharedPrisma(): PrismaClient {
  if (!prisma) prisma = createPrismaClient({ datasourceUrl: DATABASE_URL! });
  return prisma;
}

afterAll(async () => {
  await prisma?.$disconnect();
});

describe.skipIf(!live)('PRC-M583: Prisma assessment repositories tenant isolation', () => {
  it('keeps schemes, items, outcomes and results invisible to another tenant', async () => {
    const db = sharedPrisma();
    const schemes = new PrismaGradingSchemeRepository(db);
    const items = new PrismaAssessmentItemRepository(db);
    const outcomes = new PrismaOutcomeRepository(db);
    const results = new PrismaAssessmentResultRepository(db);

    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const studentId = randomUUID();
    const subjectId = randomUUID();
    const periodId = randomUUID();
    await ensurePgTestTenant(pool!, tenantA);
    await ensurePgTestTenant(pool!, tenantB);
    await ensurePgTestStudent(pool!, tenantA, studentId);

    const scheme = await schemes.create({
      id: randomUUID(),
      tenantId: tenantA,
      name: `Scale ${tenantA.slice(0, 8)}`,
      type: 'numeric',
      minValue: 0,
      maxValue: 100,
      thresholds: [
        { grade: 'P', minScore: 50, maxScore: 100 },
        { grade: 'F', minScore: 0, maxScore: 49 },
      ],
    });
    const [item] = await items.replaceItemsForSubjectPeriod(tenantA, subjectId, periodId, [
      {
        id: randomUUID(),
        tenantId: tenantA,
        subjectId,
        academicPeriodId: periodId,
        gradingSchemeId: scheme.id,
        name: 'Final',
        weight: 100,
        maxScore: 100,
        minScore: 0,
        outcomeIds: [],
      },
    ]);
    const outcome = await outcomes.create({
      id: randomUUID(),
      tenantId: tenantA,
      name: 'Reads fluently',
      code: `OUT-${tenantA.slice(0, 8)}`,
      description: null,
      subjectId,
    });
    const result = await results.upsert({
      id: randomUUID(),
      tenantId: tenantA,
      studentId,
      assessmentItemId: item!.id,
      subjectId,
      academicPeriodId: periodId,
      score: 72,
    });

    // Tenant B: reads see nothing.
    expect(await schemes.findById(scheme.id, tenantB)).toBeNull();
    expect(await schemes.findByName(scheme.name, tenantB)).toBeNull();
    const listB = await schemes.list(tenantB, {}, { page: 1, pageSize: 100 });
    expect(listB.data.map((s) => s.id)).not.toContain(scheme.id);
    expect(await items.findById(item!.id, tenantB)).toBeNull();
    expect(await items.findBySubjectAndPeriod(tenantB, subjectId, periodId)).toEqual([]);
    expect(await items.countBySubjectAndPeriod(tenantB, subjectId, periodId)).toBe(0);
    expect(await items.findByGradingScheme(tenantB, scheme.id)).toEqual([]);
    expect(await outcomes.findById(outcome.id, tenantB)).toBeNull();
    expect(await outcomes.findByIds([outcome.id], tenantB)).toEqual([]);
    expect(await outcomes.findBySubject(tenantB, subjectId)).toEqual([]);
    expect(
      await results.findByStudentSubjectPeriod(tenantB, studentId, subjectId, periodId),
    ).toEqual([]);
    expect(await results.findByStudentPeriod(tenantB, studentId, periodId)).toEqual([]);
    expect(await results.findBySubjectPeriod(tenantB, subjectId, periodId)).toEqual([]);
    expect(await results.findByAssessmentItem(tenantB, item!.id)).toEqual([]);

    // Tenant B: writes against A's ids are no-ops.
    expect(await schemes.update(scheme.id, tenantB, { name: 'hijacked' })).toBeNull();
    expect(await schemes.delete(scheme.id, tenantB)).toBe(false);
    expect(await outcomes.delete(outcome.id, tenantB)).toBe(false);
    expect(
      await results.deleteByStudentSubjectPeriod(tenantB, studentId, subjectId, periodId),
    ).toBe(0);
    await items.replaceItemsForSubjectPeriod(tenantB, subjectId, periodId, []);

    // Tenant A still sees every row unchanged.
    expect((await schemes.findById(scheme.id, tenantA))?.name).toBe(scheme.name);
    expect(await items.findBySubjectAndPeriod(tenantA, subjectId, periodId)).toHaveLength(1);
    expect(await outcomes.findById(outcome.id, tenantA)).not.toBeNull();
    const aResults = await results.findBySubjectPeriod(tenantA, subjectId, periodId);
    expect(aResults.map((r) => r.id)).toEqual([result.id]);
    expect(aResults[0]!.score).toBe(72);
  });
});
