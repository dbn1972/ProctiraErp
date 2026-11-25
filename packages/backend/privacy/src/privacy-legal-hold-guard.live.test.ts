/**
 * PRC-M203 live proof: the database legal-hold guard honours tenants.legal_hold
 * and covers the PHI tables, not only students.
 *
 * db/sql/313 adds privacy_assert_no_legal_hold() and attaches its trigger to
 * counselling_sessions and the health_* tables; 067's students trigger now goes
 * through the same function. Every write here is a direct SQL statement as the
 * runtime role (DATABASE_URL), never through PrivacyService, so a pass means the
 * database refuses the delete whatever code path issues it. Destructive probes
 * run inside a transaction that is rolled back.
 *
 * Skipped unless DATABASE_URL and MIGRATOR_DATABASE_URL are both set.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestStudent, ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'privacy-legal-hold-guard.live.test' });
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

async function asOwner(tenantId: string, sql: string, params: unknown[] = []): Promise<void> {
  const client = await ownerPool!.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_app_tenant_id($1)`, [tenantId]);
    await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
    await client.query(sql, params);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Runs `sql` as the runtime role bound to `tenantId`, always rolled back. */
async function probe(
  tenantId: string,
  sql: string,
  params: unknown[],
): Promise<{ blocked: boolean; code: string | null; message: string | null; rowCount: number }> {
  const client = await runtimePool!.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_app_tenant_id($1)`, [tenantId]);
    try {
      const res = await client.query(sql, params);
      return { blocked: false, code: null, message: null, rowCount: res.rowCount ?? 0 };
    } catch (err) {
      const e = err as { code?: string; message?: string };
      return { blocked: true, code: e.code ?? null, message: e.message ?? null, rowCount: 0 };
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function seed(): Promise<{ tenantId: string; studentId: string }> {
  const tenantId = randomUUID();
  const studentId = randomUUID();
  await ensurePgTestTenant(ownerPool!, tenantId);
  await ensurePgTestStudent(ownerPool!, tenantId, studentId);
  await asOwner(
    tenantId,
    `INSERT INTO health_allergies (id, tenant_id, student_id, allergy_type, description, severity)
     VALUES ($1, $2, $3, 'food', 'peanut', 'mild')`,
    [randomUUID(), tenantId, studentId],
  );
  await asOwner(
    tenantId,
    `INSERT INTO counselling_sessions
       (id, tenant_id, student_id, counsellor_id, session_date, session_type, reason, case_notes, status)
     VALUES ($1, $2, $3, 'counsellor-1', CURRENT_DATE, 'individual', 'probe', 'probe', 'scheduled')`,
    [randomUUID(), tenantId, studentId],
  );
  return { tenantId, studentId };
}

async function setTenantFlag(tenantId: string, held: boolean): Promise<void> {
  await asOwner(tenantId, `UPDATE tenants SET legal_hold = $2 WHERE id = $1`, [tenantId, held]);
}

async function placeSubjectHold(tenantId: string, studentId: string): Promise<void> {
  await asOwner(
    tenantId,
    `INSERT INTO privacy_legal_holds (tenant_id, scope, subject_type, subject_id, reason, placed_by)
     VALUES ($1, 'subject', 'student', $2, 'live guard probe', 'live-test')`,
    [tenantId, studentId],
  );
}

describe.skipIf(!live)('PRC-M203 legal-hold guard (live Postgres)', () => {
  it('tenants.legal_hold blocks a direct student delete', async () => {
    const { tenantId, studentId } = await seed();
    await setTenantFlag(tenantId, true);
    const res = await probe(tenantId, `DELETE FROM students WHERE id = $1`, [studentId]);
    expect(res.blocked).toBe(true);
    expect(res.code).toBe('23000');
    expect(res.message).toMatch(/legal hold/i);
  });

  it('tenants.legal_hold blocks deleting a counselling session', async () => {
    const { tenantId, studentId } = await seed();
    await setTenantFlag(tenantId, true);
    const res = await probe(tenantId, `DELETE FROM counselling_sessions WHERE student_id = $1`, [
      studentId,
    ]);
    expect(res.blocked).toBe(true);
    expect(res.code).toBe('23000');
  });

  it('a subject hold on the student blocks deleting their health rows', async () => {
    const { tenantId, studentId } = await seed();
    await placeSubjectHold(tenantId, studentId);
    const res = await probe(tenantId, `DELETE FROM health_allergies WHERE student_id = $1`, [
      studentId,
    ]);
    expect(res.blocked).toBe(true);
    expect(res.code).toBe('23000');
    expect(res.message).toMatch(/legal hold/i);
  });

  it('a hold on another student does not block (precise, not blanket)', async () => {
    const { tenantId, studentId } = await seed();
    await placeSubjectHold(tenantId, randomUUID());
    const res = await probe(tenantId, `DELETE FROM health_allergies WHERE student_id = $1`, [
      studentId,
    ]);
    expect(res.blocked).toBe(false);
    expect(res.rowCount).toBe(1);
  });

  it('clearing tenants.legal_hold lifts the block', async () => {
    const { tenantId, studentId } = await seed();
    await setTenantFlag(tenantId, true);
    await setTenantFlag(tenantId, false);
    const res = await probe(tenantId, `DELETE FROM counselling_sessions WHERE student_id = $1`, [
      studentId,
    ]);
    expect(res.blocked).toBe(false);
    expect(res.rowCount).toBe(1);
  });

  it('the guard refuses a caller bound to another tenant (no cross-tenant probe)', async () => {
    const { tenantId } = await seed();
    const other = randomUUID();
    await ensurePgTestTenant(ownerPool!, other);
    const res = await probe(other, `SELECT privacy_assert_no_legal_hold($1::uuid, NULL, NULL)`, [
      tenantId,
    ]);
    expect(res.blocked).toBe(true);
    expect(res.code).toBe('42501');
  });
});
