/**
 * PRC-M214 live proof: consent records have a DPDP erasure path (DR44).
 *
 * db/sql/316 adds SECURITY DEFINER privacy_anonymise_subject_consents(job) and
 * privacy_anonymise_tenant_consents(offboard job). They pseudonymise who on the
 * append-only consent rows and keep the consent text, version, decision, dates
 * and channel. They run only for an in-progress erasure / offboard job of the
 * bound tenant with no legal hold; a direct UPDATE stays rejected.
 *
 * Skipped unless DATABASE_URL and MIGRATOR_DATABASE_URL are both set.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PgDomainSubjectAnonymizer } from './domain-anonymizers.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'privacy-consent-anonymise.live.test' });
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

async function sql(
  pool: pg.Pool,
  tenantId: string,
  text: string,
  params: unknown[] = [],
): Promise<Array<Record<string, unknown>>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_app_tenant_id($1)`, [tenantId]);
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return res.rows as Array<Record<string, unknown>>;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const owner = (tenantId: string, text: string, params: unknown[] = []) =>
  sql(ownerPool!, tenantId, text, params);
const runtime = (tenantId: string, text: string, params: unknown[] = []) =>
  sql(runtimePool!, tenantId, text, params);

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    return String((err as { code?: string }).code);
  }
}

/** Student with one parent consent and one student consent, plus an erasure job. */
async function seed(jobStatus = 'in_progress') {
  const tenantId = randomUUID();
  const studentId = randomUUID();
  await ensurePgTestStudent(ownerPool!, tenantId, studentId);
  await owner(
    tenantId,
    `INSERT INTO parent_consents
       (id, tenant_id, student_id, parent_user_id, consent_type, title, description, status,
        consent_version, decided_at, created_by, consent_chain_id, withdrawal_reason, decided_via)
     VALUES ($1, $2, $3, 'guardian-7', 'photo_media', 'Photo consent', 'We may publish photos',
             'approved', 'v3', now(), 'guardian-7', $1, 'moving abroad', 'portal')`,
    [randomUUID(), tenantId, studentId],
  );
  await owner(
    tenantId,
    `INSERT INTO student_consents (id, tenant_id, student_id, kind, granted, actor_id)
     VALUES ($1, $2, $3, 'trips', true, 'teacher-9')`,
    [randomUUID(), tenantId, studentId],
  );
  const requestId = randomUUID();
  const jobId = randomUUID();
  await owner(
    tenantId,
    `INSERT INTO privacy_erasure_requests
       (id, tenant_id, subject_type, subject_id, status, requested_by, reviewed_by)
     VALUES ($1, $2, 'student', $3, 'in_progress', 'dpo-1', 'dpo-2')`,
    [requestId, tenantId, studentId],
  );
  await owner(
    tenantId,
    `INSERT INTO privacy_anonymization_jobs
       (id, tenant_id, erasure_request_id, subject_type, subject_id, request_type, status, actor_id)
     VALUES ($1, $2, $3, 'student', $4, 'erasure', $5, 'dpo-2')`,
    [jobId, tenantId, requestId, studentId, jobStatus],
  );
  return { tenantId, studentId, jobId };
}

async function consents(tenantId: string, studentId: string) {
  const parent = await owner(
    tenantId,
    `SELECT parent_user_id, created_by, withdrawal_reason, title, description, consent_version,
            status, decided_via
       FROM parent_consents WHERE student_id = $1`,
    [studentId],
  );
  const student = await owner(
    tenantId,
    `SELECT actor_id, kind, granted FROM student_consents WHERE student_id = $1`,
    [studentId],
  );
  return { parent: parent[0]!, student: student[0]! };
}

describe.skipIf(!live)('PRC-M214 consent anonymisation (live Postgres)', () => {
  it('an in-progress erasure job pseudonymises who and keeps the proof', async () => {
    const { tenantId, studentId, jobId } = await seed();
    const rows = await runtime(tenantId, `SELECT privacy_anonymise_subject_consents($1) AS n`, [
      jobId,
    ]);
    expect(rows[0]?.['n']).toBe(2);
    const { parent, student } = await consents(tenantId, studentId);
    expect(parent['parent_user_id']).toMatch(/^anon:[0-9a-f]{16}$/);
    expect(parent['created_by']).toBe(parent['parent_user_id']);
    expect(parent).toMatchObject({
      withdrawal_reason: null,
      title: 'Photo consent',
      description: 'We may publish photos',
      consent_version: 'v3',
      status: 'approved',
      decided_via: 'portal',
    });
    expect(student).toMatchObject({ kind: 'trips', granted: true });
    expect(student['actor_id']).toBe(parent['parent_user_id']);
  });

  it('refuses a job that is not in progress', async () => {
    const { tenantId, jobId } = await seed('queued');
    expect(
      await codeOf(runtime(tenantId, `SELECT privacy_anonymise_subject_consents($1)`, [jobId])),
    ).toBe('55000');
  });

  it('refuses while the student is on legal hold', async () => {
    const { tenantId, studentId, jobId } = await seed();
    await owner(
      tenantId,
      `INSERT INTO privacy_legal_holds (tenant_id, scope, subject_type, subject_id, reason, placed_by)
       VALUES ($1, 'subject', 'student', $2, 'probe', 'live-test')`,
      [tenantId, studentId],
    );
    expect(
      await codeOf(runtime(tenantId, `SELECT privacy_anonymise_subject_consents($1)`, [jobId])),
    ).toBe('23000');
    expect((await consents(tenantId, studentId)).parent['parent_user_id']).toBe('guardian-7');
  });

  it('a direct UPDATE that forges the flag is still rejected', async () => {
    const { tenantId, studentId } = await seed();
    const client = await runtimePool!.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_app_tenant_id($1)`, [tenantId]);
      await client.query(`SELECT set_config('app.privacy_consent_anonymise', 'on', true)`);
      expect(
        await codeOf(
          client.query(
            `UPDATE parent_consents SET parent_user_id = 'anon:0000000000000000' WHERE student_id = $1`,
            [studentId],
          ),
        ),
      ).toBe('23000');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('the subject anonymizer erases consent identities through the job', async () => {
    const { tenantId, studentId, jobId } = await seed();
    const result = await new PgDomainSubjectAnonymizer(runtimePool!).anonymize({
      tenantId,
      subjectType: 'student',
      subjectId: studentId,
      requestType: 'erasure',
      jobId,
    });
    expect(result.fieldsTouched).toContain('parent_consents.parent_user_id');
    expect(result.residualNote ?? '').not.toMatch(/consent/);
    const { parent, student } = await consents(tenantId, studentId);
    expect(parent['parent_user_id']).toMatch(/^anon:/);
    expect(student['actor_id']).toMatch(/^anon:/);
  });

  it('an in-progress offboard job anonymises every consent of the tenant', async () => {
    const { tenantId, studentId } = await seed();
    const offboardId = randomUUID();
    await owner(
      tenantId,
      `INSERT INTO privacy_tenant_offboard_jobs (id, tenant_id, status, reason, requested_by)
       VALUES ($1, $2, 'in_progress', 'probe', 'platform-1')`,
      [offboardId, tenantId],
    );
    const rows = await runtime(tenantId, `SELECT privacy_anonymise_tenant_consents($1) AS n`, [
      offboardId,
    ]);
    expect(rows[0]?.['n']).toBe(2);
    expect((await consents(tenantId, studentId)).parent['parent_user_id']).toMatch(/^anon:/);
  });
});
