/**
 * G-812 — Postgres smoke for examination repository (create → findById → cross-tenant RLS).
 *
 * Skips cleanly when DATABASE_URL is unset. Requires a migrated DB (examinations + tenants).
 *
 * Follow-ups (remaining G-812 packages without pg smoke — do not stub fake passing tests):
 * see docs/audits/G812_PG_COVERAGE.md
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool, withPgTenant } from '@proctira/database';
import { afterEach, describe, expect, it } from 'vitest';

import { InMemoryExaminationRepository } from './in-memory-repository.js';
import { PrismaExaminationRepository } from './prisma-examination-repository.js';
import {
  createExaminationRepository,
  isPgExaminationEnabled,
} from './repository-factory.js';

const created: Array<{ id: string; tenantId: string }> = [];

async function seedTenant(tenantId: string): Promise<void> {
  const pool = getSharedPgPool();
  expect(pool).not.toBeNull();
  await withPgTenant(pool!, tenantId, (client) =>
    client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `exam-${tenantId.slice(0, 8)}`, `exam-${tenantId}`],
    ),
  );
}

describe('createExaminationRepository', () => {
  it('falls back to in-memory when DATABASE_URL is unset', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      expect(isPgExaminationEnabled()).toBe(false);
      expect(createExaminationRepository()).toBeInstanceOf(InMemoryExaminationRepository);
    } finally {
      if (prev !== undefined) process.env.DATABASE_URL = prev;
      else delete process.env.DATABASE_URL;
    }
  });

  it.skipIf(!isPgExaminationEnabled())(
    'returns PrismaExaminationRepository when DATABASE_URL is set',
    () => {
      expect(createExaminationRepository()).toBeInstanceOf(PrismaExaminationRepository);
    },
  );
});

describe('PgExaminationRepository', () => {
  afterEach(async () => {
    if (!isPgExaminationEnabled() || created.length === 0) return;
    const repo = createExaminationRepository();
    while (created.length > 0) {
      const row = created.pop()!;
      await repo.delete(row.id, row.tenantId);
    }
  });

  it.skipIf(!isPgExaminationEnabled())(
    'creates, finds by id in-tenant, and denies cross-tenant reads',
    async () => {
      const repo = createExaminationRepository();
      const tenantA = randomUUID();
      const tenantB = randomUUID();
      await Promise.all([seedTenant(tenantA), seedTenant(tenantB)]);

      const examId = randomUUID();
      const createdExam = await repo.create({
        id: examId,
        tenantId: tenantA,
        name: 'Mid-Year Board Exam',
        code: `EX-${examId.slice(0, 8)}`,
        description: 'G-812 smoke',
        // academic_period_id has no FK — random UUID is enough for the smoke.
        academicPeriodId: randomUUID(),
        startDate: '2026-06-01',
        endDate: '2026-06-15',
        status: 'DRAFT',
        subjects: [],
        centers: [],
        sessions: [],
        gradingSchemes: [],
      });
      created.push({ id: examId, tenantId: tenantA });

      expect(createdExam.id).toBe(examId);
      expect(createdExam.name).toBe('Mid-Year Board Exam');

      const found = await repo.findById(examId, tenantA);
      expect(found).not.toBeNull();
      expect(found?.code).toBe(createdExam.code);

      expect(await repo.findById(examId, tenantB)).toBeNull();
      const otherList = await repo.list(tenantB, {}, { page: 1, pageSize: 20 });
      expect(otherList.data).toHaveLength(0);
      expect(otherList.meta.totalItems).toBe(0);
    },
  );
});
