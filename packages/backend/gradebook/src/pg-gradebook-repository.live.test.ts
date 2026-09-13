/**
 * Live Postgres proof for PgGradebookRepository (G-732): credit rules and
 * grading scales persist through `withPgTenant`, and a second tenant cannot
 * read them under FORCE RLS. Skipped without DATABASE_URL.
 *
 * W3-TEST-01 — also covers grade workflow transitions persisted + reloaded.
 */
import { randomUUID } from 'node:crypto';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';

import { withPgTenant } from '@proctira/database';
import { describe, expect, it } from 'vitest';

import { GradebookService } from './gradebook-service.js';
import { getSharedGradebookPool, PgGradebookRepository } from './pg-gradebook-repository.js';
const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-gradebook-repository.live.test' });


const pool = getSharedGradebookPool();
const live = Boolean(DATABASE_URL) && pool !== null;

async function seedTenant(tenantId: string): Promise<void> {
  await withPgTenant(pool!, tenantId, (client) =>
    client.query(
      `INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
      [tenantId, `gradebook-test-${tenantId.slice(0, 8)}`, `gradebook-test-${tenantId}`],
    ),
  );
}

async function seedBoard(tenantId: string): Promise<string> {
  const boardId = randomUUID();
  await withPgTenant(pool!, tenantId, (client) =>
    client.query(
      `INSERT INTO boards (id, tenant_id, name, code, type) VALUES ($1, $2, 'Test Board', $3, 'STATE')`,
      [boardId, tenantId, `TB-${boardId.slice(0, 8)}`],
    ),
  );
  return boardId;
}

async function seedStudent(tenantId: string): Promise<string> {
  const studentId = randomUUID();
  await withPgTenant(pool!, tenantId, (client) =>
    client.query(
      `INSERT INTO students (id, tenant_id, first_name, last_name, date_of_birth, gender)
       VALUES ($1, $2, 'Live', 'Student', '2008-01-15', 'F')`,
      [studentId, tenantId],
    ),
  );
  return studentId;
}

describe('PgGradebookRepository (live)', () => {
  it.skipIf(!live)('persists credit rules per tenant and isolates them under RLS', async () => {
    const repo = new PgGradebookRepository(pool!);
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await Promise.all([seedTenant(tenantA), seedTenant(tenantB)]);

    const now = new Date().toISOString();
    const created = await repo.createCreditRule({
      id: randomUUID(),
      tenantId: tenantA,
      boardId: null,
      code: 'MATH-101',
      name: 'Mathematics',
      credits: 4,
      metadata: { level: 'secondary' },
      createdAt: now,
      updatedAt: now,
    });
    expect(created.code).toBe('MATH-101');
    expect(created.credits).toBe(4);

    const byCode = await repo.getCreditRuleByCode(tenantA, 'MATH-101');
    expect(byCode?.id).toBe(created.id);
    expect(byCode?.metadata).toEqual({ level: 'secondary' });

    const listA = await repo.listCreditRules(tenantA);
    expect(listA.map((r) => r.code)).toEqual(['MATH-101']);

    // Tenant B sees nothing — even by exact code — because the GUC is bound per call.
    expect(await repo.listCreditRules(tenantB)).toEqual([]);
    expect(await repo.getCreditRuleByCode(tenantB, 'MATH-101')).toBeNull();

    // (tenant_id, code) is unique: re-inserting the same code for A is rejected.
    await expect(repo.createCreditRule({ ...created, id: randomUUID() })).rejects.toThrow(
      /duplicate key|unique/i,
    );
  });

  it.skipIf(!live)('reads grading scales only for the bound tenant', async () => {
    const repo = new PgGradebookRepository(pool!);
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    await Promise.all([seedTenant(tenantA), seedTenant(tenantB)]);

    const boardId = await seedBoard(tenantA);
    const scaleId = randomUUID();
    await withPgTenant(pool!, tenantA, async (client) => {
      await client.query(
        `INSERT INTO grading_scales (id, tenant_id, board_id, code, name, is_default)
         VALUES ($1, $2, $3, 'STD-10', 'Standard 10-point', true)`,
        [scaleId, tenantA, boardId],
      );
      await client.query(
        `INSERT INTO grading_scale_bands (tenant_id, grading_scale_id, label, min_percent, max_percent, grade_points, sort_order)
         VALUES ($1, $2, 'A', 90, 100, 10, 1), ($1, $2, 'B', 80, 89.99, 9, 2)`,
        [tenantA, scaleId],
      );
    });

    const scale = await repo.getGradingScale(tenantA, scaleId);
    expect(scale?.code).toBe('STD-10');
    expect(scale?.bands.map((b) => b.label)).toEqual(['A', 'B']);
    expect((await repo.getDefaultGradingScale(tenantA, boardId))?.id).toBe(scaleId);
    expect((await repo.listGradingScales(tenantA, boardId)).some((s) => s.id === scaleId)).toBe(
      true,
    );

    expect(await repo.getGradingScale(tenantB, scaleId)).toBeNull();
    expect(await repo.getDefaultGradingScale(tenantB, boardId)).toBeNull();
    expect((await repo.listGradingScales(tenantB)).some((s) => s.id === scaleId)).toBe(false);
  });

  it.skipIf(!live)(
    'transitionGradeEntry persists workflow + lock and blocks edits after lock (W3-TEST-01)',
    async () => {
      const repo = new PgGradebookRepository(pool!);
      const service = new GradebookService(repo);
      const tenantId = randomUUID();
      await seedTenant(tenantId);
      const studentId = await seedStudent(tenantId);

      const entry = await service.upsertGradeEntry(tenantId, {
        studentId,
        assessmentCode: `LIVE-${randomUUID().slice(0, 6)}`,
        numericScore: 91,
      });
      expect(entry.metadata.workflowStatus).toBe('DRAFT');

      const submitted = await service.transitionGradeEntry(tenantId, entry.id, 'submit');
      expect(submitted.metadata.workflowStatus).toBe('SUBMITTED');

      await expect(
        service.upsertGradeEntry(tenantId, {
          studentId,
          assessmentCode: entry.assessmentCode ?? undefined,
          numericScore: 80,
        }),
      ).rejects.toThrow(/SUBMITTED/);

      await service.transitionGradeEntry(tenantId, entry.id, 'approve');
      const locked = await service.transitionGradeEntry(tenantId, entry.id, 'lock');
      expect(locked.metadata.workflowStatus).toBe('LOCKED');
      expect(locked.lockedAt).toBeTruthy();

      const reloaded = await repo.getGradeEntry(tenantId, entry.id);
      expect(reloaded?.metadata.workflowStatus).toBe('LOCKED');
      expect(reloaded?.lockedAt).toBeTruthy();

      await expect(
        service.upsertGradeEntry(tenantId, {
          studentId,
          assessmentCode: entry.assessmentCode ?? undefined,
          numericScore: 70,
        }),
      ).rejects.toThrow(/locked/i);

      await expect(service.transitionGradeEntry(tenantId, entry.id, 'approve')).rejects.toThrow();
    },
  );
});
