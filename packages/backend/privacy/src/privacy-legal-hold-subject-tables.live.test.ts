/**
 * PRC-M325 live proof: the legal-hold guard covers every subject table, and the
 * Postgres erasure / tenant-wipe executors re-check the hold inside their own
 * transaction.
 *
 * db/sql/314 attaches the 313 guard to the staff, guardian and student-linked
 * tables. domain-anonymizers.ts calls privacy_assert_no_legal_hold() before the
 * first write, so a hold the service did not see (tenants.legal_hold, or a hold
 * placed after the job started) stops the run with nothing changed. Direct SQL
 * probes run as the runtime role inside a rolled-back transaction.
 *
 * Skipped unless DATABASE_URL and MIGRATOR_DATABASE_URL are both set.
 */
import { randomUUID } from 'node:crypto';
import {
  ensurePgTestStaff,
  ensurePgTestStudent,
  ensurePgTestTenant,
} from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PgDomainSubjectAnonymizer, PgTenantWipeExecutor } from './domain-anonymizers.js';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'privacy-legal-hold-subject-tables.live.test',
});
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

async function asOwner(tenantId: string, sql: string, params: unknown[] = []): Promise<unknown[]> {
  const client = await ownerPool!.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_app_tenant_id($1)`, [tenantId]);
    await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
    const res = await client.query(sql, params);
    await client.query('COMMIT');
    return res.rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function probe(
  tenantId: string,
  sql: string,
  params: unknown[],
): Promise<{ blocked: boolean; code: string | null; rowCount: number }> {
  const client = await runtimePool!.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_app_tenant_id($1)`, [tenantId]);
    try {
      const res = await client.query(sql, params);
      return { blocked: false, code: null, rowCount: res.rowCount ?? 0 };
    } catch (err) {
      return { blocked: true, code: (err as { code?: string }).code ?? null, rowCount: 0 };
    }
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function hold(tenantId: string, subjectType: string, subjectId: string): Promise<void> {
  await asOwner(
    tenantId,
    `INSERT INTO privacy_legal_holds (tenant_id, scope, subject_type, subject_id, reason, placed_by)
     VALUES ($1, 'subject', $2, $3, 'live guard probe', 'live-test')`,
    [tenantId, subjectType, subjectId],
  );
}

async function flagTenant(tenantId: string): Promise<void> {
  await asOwner(tenantId, `UPDATE tenants SET legal_hold = true WHERE id = $1`, [tenantId]);
}

async function seedStudent(): Promise<{ tenantId: string; studentId: string }> {
  const tenantId = randomUUID();
  const studentId = randomUUID();
  await ensurePgTestStudent(ownerPool!, tenantId, studentId);
  return { tenantId, studentId };
}

describe.skipIf(!live)('PRC-M325 legal-hold guard on subject tables (live Postgres)', () => {
  it('a staff subject hold blocks deleting the staff row', async () => {
    const tenantId = randomUUID();
    const staffId = randomUUID();
    await ensurePgTestStaff(ownerPool!, tenantId, staffId);
    await hold(tenantId, 'staff', staffId);
    const res = await probe(tenantId, `DELETE FROM staff WHERE id = $1`, [staffId]);
    expect(res).toMatchObject({ blocked: true, code: '23000' });
  });

  it('tenants.legal_hold blocks deleting a student document row', async () => {
    const { tenantId, studentId } = await seedStudent();
    await asOwner(
      tenantId,
      `INSERT INTO student_documents
         (id, tenant_id, student_id, category, file_name, object_key, mime_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, 'other', 'f.pdf', 'k/f.pdf', 'application/pdf', 10, 'live-test')`,
      [randomUUID(), tenantId, studentId],
    );
    await flagTenant(tenantId);
    const res = await probe(tenantId, `DELETE FROM student_documents WHERE student_id = $1`, [
      studentId,
    ]);
    expect(res).toMatchObject({ blocked: true, code: '23000' });
  });

  it('a guardian subject hold blocks deleting their parent-child link', async () => {
    const { tenantId, studentId } = await seedStudent();
    const guardian = `guardian-${randomUUID()}`;
    await asOwner(
      tenantId,
      `INSERT INTO parent_child_links (id, tenant_id, parent_user_id, student_id, relationship, status)
       VALUES ($1, $2, $3, $4, 'guardian', 'active')`,
      [randomUUID(), tenantId, guardian, studentId],
    );
    await hold(tenantId, 'parent', guardian);
    const res = await probe(tenantId, `DELETE FROM parent_child_links WHERE parent_user_id = $1`, [
      guardian,
    ]);
    expect(res).toMatchObject({ blocked: true, code: '23000' });
  });

  it('a guardian subject hold blocks deleting the messages they sent', async () => {
    const { tenantId, studentId } = await seedStudent();
    const guardian = `guardian-${randomUUID()}`;
    const threadId = randomUUID();
    await asOwner(
      tenantId,
      `INSERT INTO parent_message_threads (id, tenant_id, student_id, subject, created_by)
       VALUES ($1, $2, $3, 'probe', $4)`,
      [threadId, tenantId, studentId, guardian],
    );
    await asOwner(
      tenantId,
      `INSERT INTO parent_messages (id, thread_id, tenant_id, sender_user_id, sender_role, body)
       VALUES ($1, $2, $3, $4, 'parent', 'probe')`,
      [randomUUID(), threadId, tenantId, guardian],
    );
    await hold(tenantId, 'parent', guardian);
    const res = await probe(tenantId, `DELETE FROM parent_messages WHERE sender_user_id = $1`, [
      guardian,
    ]);
    expect(res).toMatchObject({ blocked: true, code: '23000' });
  });
  it('a guardian subject hold blocks deleting the fee payments they made', async () => {
    const { tenantId, studentId } = await seedStudent();
    const guardian = `guardian-${randomUUID()}`;
    const invoiceId = randomUUID();
    await asOwner(
      tenantId,
      `INSERT INTO parent_fee_invoices (id, tenant_id, student_id, title, amount_cents)
       VALUES ($1, $2, $3, 'probe', 100)`,
      [invoiceId, tenantId, studentId],
    );
    await asOwner(
      tenantId,
      `INSERT INTO parent_fee_payments (id, invoice_id, tenant_id, payer_user_id, amount_cents, status)
       VALUES ($1, $2, $3, $4, 100, 'pending')`,
      [randomUUID(), invoiceId, tenantId, guardian],
    );
    await hold(tenantId, 'parent', guardian);
    const res = await probe(tenantId, `DELETE FROM parent_fee_payments WHERE payer_user_id = $1`, [
      guardian,
    ]);
    expect(res).toMatchObject({ blocked: true, code: '23000' });
  });
  it('a guardian subject hold blocks deleting a custody restriction on that guardian', async () => {
    const { tenantId, studentId } = await seedStudent();
    const guardian = `guardian-${randomUUID()}`;
    await asOwner(
      tenantId,
      `INSERT INTO guardian_custody_restrictions (id, tenant_id, student_id, parent_user_id)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), tenantId, studentId, guardian],
    );
    await hold(tenantId, 'parent', guardian);
    const res = await probe(
      tenantId,
      `DELETE FROM guardian_custody_restrictions WHERE parent_user_id = $1`,
      [guardian],
    );
    expect(res).toMatchObject({ blocked: true, code: '23000' });
  });
  it('a sibling link is held through either student', async () => {
    const { tenantId, studentId } = await seedStudent();
    const siblingId = randomUUID();
    await ensurePgTestStudent(ownerPool!, tenantId, siblingId);
    await asOwner(
      tenantId,
      `INSERT INTO student_siblings (id, tenant_id, student_id, sibling_id) VALUES ($1, $2, $3, $4)`,
      [randomUUID(), tenantId, studentId, siblingId],
    );
    await hold(tenantId, 'student', siblingId);
    const res = await probe(tenantId, `DELETE FROM student_siblings WHERE student_id = $1`, [
      studentId,
    ]);
    expect(res).toMatchObject({ blocked: true, code: '23000' });
  });

  it('without a hold the subject-table delete proceeds', async () => {
    const tenantId = randomUUID();
    const staffId = randomUUID();
    await ensurePgTestStaff(ownerPool!, tenantId, staffId);
    const res = await probe(tenantId, `DELETE FROM staff WHERE id = $1`, [staffId]);
    expect(res).toMatchObject({ blocked: false, rowCount: 1 });
  });

  it('the subject anonymizer stops on tenants.legal_hold with nothing changed', async () => {
    const { tenantId, studentId } = await seedStudent();
    await flagTenant(tenantId);
    const anonymizer = new PgDomainSubjectAnonymizer(runtimePool!);
    const result = await anonymizer.anonymize({
      tenantId,
      subjectType: 'student',
      subjectId: studentId,
      requestType: 'erasure',
      jobId: randomUUID(),
    });
    expect(result.fieldsTouched).toEqual([]);
    expect(result.residualNote).toMatch(/legal hold/i);
    const rows = (await asOwner(tenantId, `SELECT first_name FROM students WHERE id = $1`, [
      studentId,
    ])) as Array<{ first_name: string }>;
    expect(rows[0]?.first_name).toBe('Test');
  });

  it('the tenant wipe stops on a tenant hold before deleting anything or wiping objects', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(ownerPool!, tenantId);
    await asOwner(
      tenantId,
      `INSERT INTO privacy_legal_holds (tenant_id, scope, reason, placed_by)
       VALUES ($1, 'tenant', 'live wipe probe', 'live-test')`,
      [tenantId],
    );
    let wiped = false;
    const executor = new PgTenantWipeExecutor(runtimePool!, {
      objectStoreWiper: {
        wipeTenant: async () => {
          wiped = true;
        },
      },
    });
    const results = await executor.wipe({ tenantId, jobId: randomUUID(), reason: 'probe' });
    expect(results).toEqual([
      expect.objectContaining({ domain: 'legal_hold', status: 'residual' }),
    ]);
    expect(wiped).toBe(false);
  });
});
