/**
 * PRC-M215 — live Postgres proof for the scholarship application document
 * retention default (db/sql/249, replaced by 319).
 *
 * A new INSERT without retention_until gets the DR35 default (uploaded_at +
 * 8 years; 249's interim default was 7 years), and an INSERT with an explicit
 * retention_until is not overwritten.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 104
 * (scholarship_application_documents), 249 and 319.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

import { isPgScholarshipEnabled } from './create-scholarship-repository.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const live = isPgScholarshipEnabled();

describe.skipIf(!live)('PRC-M215 scholarship document retention default (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedApplication(
    client: pg.PoolClient,
  ): Promise<{ tenantId: string; applicationId: string }> {
    const tenantId = randomUUID();
    const programId = randomUUID();
    const applicationId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    await client.query(
      `INSERT INTO scholarship_programs (
         id, tenant_id, name, description, application_start_date, application_end_date,
         total_slots, used_slots, amount_per_recipient, amount_per_recipient_cents, currency,
         disbursement_frequency, eligibility, status
       ) VALUES ($1, $2, 'M215 Program', NULL, '2026-01-01', '2026-12-31', 10, 0, 1000, 100000,
         'INR', 'one_time', '{}'::jsonb, 'open')`,
      [programId, tenantId],
    );
    await client.query(
      `INSERT INTO scholarship_applications (
         id, tenant_id, program_id, applicant_id, institution_id, status
       ) VALUES ($1, $2, $3, $4, $5, 'submitted')`,
      [applicationId, tenantId, programId, randomUUID(), randomUUID()],
    );
    return { tenantId, applicationId };
  }

  it('a new document without retention_until gets the +8-years DR35 default from uploaded_at', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId, applicationId } = await seedApplication(client);
      const docId = randomUUID();
      const uploadedAt = '2026-03-15T00:00:00Z';

      await client.query(
        `INSERT INTO scholarship_application_documents (
           id, tenant_id, application_id, document_type, object_key, original_filename,
           mime_type, size_bytes, sha256, uploaded_by, uploaded_at
         ) VALUES ($1, $2, $3, 'income_certificate', 'key-1', 'income.pdf', 'application/pdf',
           1024, repeat('a', 64), 'staff-1', $4)`,
        [docId, tenantId, applicationId, uploadedAt],
      );

      const { rows } = await client.query<{ retention_until: Date; uploaded_at: string }>(
        `SELECT retention_until, uploaded_at FROM scholarship_application_documents WHERE id = $1`,
        [docId],
      );
      expect(rows[0]!.retention_until.toISOString().slice(0, 10)).toBe('2034-03-15');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('a new document with an explicit retention_until is not overwritten', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { tenantId, applicationId } = await seedApplication(client);
      const docId = randomUUID();

      await client.query(
        `INSERT INTO scholarship_application_documents (
           id, tenant_id, application_id, document_type, object_key, original_filename,
           mime_type, size_bytes, sha256, uploaded_by, uploaded_at, retention_until
         ) VALUES ($1, $2, $3, 'marksheet', 'key-2', 'marksheet.pdf', 'application/pdf',
           2048, repeat('b', 64), 'staff-1', '2026-01-01T00:00:00Z', '2030-01-01')`,
        [docId, tenantId, applicationId],
      );

      const { rows } = await client.query<{ retention_until: Date }>(
        `SELECT retention_until FROM scholarship_application_documents WHERE id = $1`,
        [docId],
      );
      expect(rows[0]!.retention_until.toISOString().slice(0, 10)).toBe('2030-01-01');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
