/**
 * Live Postgres proof that a privacy legal hold blocks destructive deletion of a
 * student record (W1-SEC-06).
 *
 * `privacy-service.ts` refuses erasure while a hold is active, but application
 * logic is only one of the two layers: `db/sql/067_privacy_legal_hold_erasure.sql`
 * installs `trg_privacy_block_student_delete_on_legal_hold` on `students`, so the
 * database refuses the delete even when the write bypasses the service entirely.
 *
 * That database layer is the one that matters for a hold's legal weight, and it
 * can only be proven against a real Postgres. These tests therefore write to
 * `students` **directly**, never through `PrivacyService`, so a passing result
 * means the guard holds regardless of which code path attempts the delete.
 *
 * Covered:
 *   - hard DELETE under a subject-scoped hold
 *   - soft delete (`deleted_at`) under a subject-scoped hold
 *   - soft delete under a tenant-scoped hold (no subject named)
 *   - the guard is precise, not blanket: with no active hold the delete proceeds
 *   - releasing a hold lifts the block
 *
 * Every destructive assertion runs inside a transaction that is rolled back, so
 * the suite never actually removes a student row.
 *
 * Skipped unless DATABASE_URL and MIGRATOR_DATABASE_URL are both set.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PgPrivacyRepository } from './pg-privacy-repository.js';
import type { LegalHoldEntity } from './privacy-repository.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-privacy-legal-hold.live.test' });
const MIGRATOR_DATABASE_URL = process.env['MIGRATOR_DATABASE_URL']?.trim();

const runtimePool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;
const ownerPool = MIGRATOR_DATABASE_URL
  ? new pg.Pool({ connectionString: MIGRATOR_DATABASE_URL, max: 2 })
  : null;

const live = Boolean(runtimePool && ownerPool);

afterAll(async () => {
  await runtimePool?.end();
  await ownerPool?.end();
});

function hold(
  tenantId: string,
  scope: 'tenant' | 'subject',
  subjectId: string | null,
): Omit<LegalHoldEntity, 'createdAt' | 'updatedAt'> {
  return {
    id: randomUUID(),
    tenantId,
    scope,
    subjectType: scope === 'subject' ? 'student' : null,
    subjectId,
    reason: 'live legal-hold probe',
    placedBy: 'live-test',
    placedAt: new Date(),
    releasedBy: null,
    releasedAt: null,
    active: true,
  };
}

/** Fresh tenant + student per test so probes never interfere with each other. */
async function seedSubject(): Promise<{
  tenantId: string;
  studentId: string;
  repo: PgPrivacyRepository;
}> {
  const tenantId = randomUUID();
  const studentId = randomUUID();
  await ensurePgTestTenant(ownerPool!, tenantId);
  await ensurePgTestStudent(ownerPool!, tenantId, studentId);
  return { tenantId, studentId, repo: new PgPrivacyRepository(runtimePool!) };
}

/**
 * Attempt a destructive write on `students` as the owner, scoped to the tenant
 * because `students` is under FORCE ROW LEVEL SECURITY, then always roll back.
 * Resolves to the thrown message, or null when the write was permitted.
 */
async function attemptDestructive(
  tenantId: string,
  sql: string,
  params: unknown[],
): Promise<{ blocked: boolean; message: string | null; rowCount: number }> {
  const client = await ownerPool!.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    try {
      const result = await client.query(sql, params);
      return { blocked: false, message: null, rowCount: result.rowCount ?? 0 };
    } catch (error) {
      return { blocked: true, message: (error as Error).message, rowCount: 0 };
    }
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
  }
}

const HARD_DELETE = 'DELETE FROM students WHERE id = $1';
const SOFT_DELETE = 'UPDATE students SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL';

describe('privacy legal hold blocks destructive deletion (live Postgres)', () => {
  it.skipIf(!live)('a subject-scoped hold blocks a hard DELETE', async () => {
    const { tenantId, studentId, repo } = await seedSubject();
    await repo.createLegalHold(hold(tenantId, 'subject', studentId));

    const result = await attemptDestructive(tenantId, HARD_DELETE, [studentId]);

    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/legal hold/i);
    expect(result.message).toMatch(/W1-SEC-06/);
  });

  it.skipIf(!live)('a subject-scoped hold blocks a soft delete', async () => {
    const { tenantId, studentId, repo } = await seedSubject();
    await repo.createLegalHold(hold(tenantId, 'subject', studentId));

    const result = await attemptDestructive(tenantId, SOFT_DELETE, [studentId]);

    expect(result.blocked).toBe(true);
    expect(result.message).toMatch(/legal hold/i);
  });

  it.skipIf(!live)(
    'a tenant-scoped hold blocks a soft delete without naming the subject',
    async () => {
      const { tenantId, studentId, repo } = await seedSubject();
      await repo.createLegalHold(hold(tenantId, 'tenant', null));

      const result = await attemptDestructive(tenantId, SOFT_DELETE, [studentId]);

      expect(result.blocked).toBe(true);
      expect(result.message).toMatch(/legal hold/i);
    },
  );

  it.skipIf(!live)('the guard is precise: with no active hold the delete proceeds', async () => {
    const { tenantId, studentId, repo } = await seedSubject();
    expect(await repo.listActiveLegalHolds(tenantId)).toHaveLength(0);

    const result = await attemptDestructive(tenantId, SOFT_DELETE, [studentId]);

    // Rolled back, so the row survives — this only proves the guard did not fire.
    expect(result.blocked).toBe(false);
    expect(result.rowCount).toBe(1);
  });

  it.skipIf(!live)('releasing the hold lifts the block', async () => {
    const { tenantId, studentId, repo } = await seedSubject();
    const created = await repo.createLegalHold(hold(tenantId, 'subject', studentId));

    const whileHeld = await attemptDestructive(tenantId, SOFT_DELETE, [studentId]);
    expect(whileHeld.blocked).toBe(true);

    await repo.updateLegalHold(created.id, tenantId, {
      active: false,
      releasedBy: 'live-test',
      releasedAt: new Date(),
    });
    expect(await repo.listActiveLegalHolds(tenantId)).toHaveLength(0);

    const afterRelease = await attemptDestructive(tenantId, SOFT_DELETE, [studentId]);
    expect(afterRelease.blocked).toBe(false);
    expect(afterRelease.rowCount).toBe(1);
  });

  it.skipIf(!live)('a hold in another tenant does not block this tenant', async () => {
    const a = await seedSubject();
    const b = await seedSubject();
    await a.repo.createLegalHold(hold(a.tenantId, 'tenant', null));

    const blockedInA = await attemptDestructive(a.tenantId, SOFT_DELETE, [a.studentId]);
    expect(blockedInA.blocked).toBe(true);

    const allowedInB = await attemptDestructive(b.tenantId, SOFT_DELETE, [b.studentId]);
    expect(allowedInB.blocked).toBe(false);
    expect(allowedInB.rowCount).toBe(1);
  });
});
