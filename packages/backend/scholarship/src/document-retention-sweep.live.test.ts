/**
 * PRC-M215 (DR35) on a migrated Postgres as the runtime app role (RLS on):
 * - the retention sweep erases the stored object, then the document row past
 *   its retention date, with a chained DELETE audit entry; a document inside
 *   its window stays;
 * - db/sql/319: deleting an application that still has documents is refused
 *   (ON DELETE RESTRICT) instead of cascading away the rows and their keys.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 319.
 */
import { randomUUID } from 'node:crypto';
import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPgScholarshipEnabled } from './create-scholarship-repository.js';
import { InMemoryScholarshipDocumentBlobStore } from './document-blob-store.js';
import { ScholarshipDocumentService } from './document-service.js';
import { PgScholarshipDocumentStore } from './pg-document-store.js';
import type { ScholarshipService } from './scholarship-service.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const live = isPgScholarshipEnabled();

describe.skipIf(!live)('PRC-M215 scholarship document retention sweep (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });
  afterAll(async () => {
    await pool.end();
  });

  async function seed() {
    const tenantId = randomUUID();
    const programId = randomUUID();
    const applicationId = randomUUID();
    const expiredId = randomUUID();
    const keptId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    await withPgTenant(pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO scholarship_programs (
           id, tenant_id, name, description, application_start_date, application_end_date,
           total_slots, used_slots, amount_per_recipient, amount_per_recipient_cents, currency,
           disbursement_frequency, eligibility, status
         ) VALUES ($1, $2, 'M215 Sweep', NULL, '2026-01-01', '2026-12-31', 10, 0, 1000, 100000,
           'INR', 'one_time', '{}'::jsonb, 'open')`,
        [programId, tenantId],
      );
      await client.query(
        `INSERT INTO scholarship_applications (
           id, tenant_id, program_id, applicant_id, institution_id, status
         ) VALUES ($1, $2, $3, $4, $5, 'submitted')`,
        [applicationId, tenantId, programId, randomUUID(), randomUUID()],
      );
      for (const [id, retention] of [
        [expiredId, '2025-01-01'],
        [keptId, null],
      ] as const) {
        await client.query(
          `INSERT INTO scholarship_application_documents (
             id, tenant_id, application_id, document_type, object_key, original_filename,
             mime_type, size_bytes, sha256, uploaded_by, retention_until
           ) VALUES ($1, $2, $3, 'income_certificate', $4, 'income.pdf', 'application/pdf',
             1024, repeat('a', 64), 'staff-1', $5)`,
          [id, tenantId, applicationId, `scholarships/${applicationId}/documents/${id}`, retention],
        );
      }
    });
    return { tenantId, applicationId, expiredId, keptId };
  }

  it('erases object then row past retention, audited; keeps a document inside its window', async () => {
    const fx = await seed();
    const blobs = new InMemoryScholarshipDocumentBlobStore();
    const keyOf = (id: string) => `scholarships/${fx.applicationId}/documents/${id}`;
    await blobs.put(keyOf(fx.expiredId), Buffer.from('expired'));
    await blobs.put(keyOf(fx.keptId), Buffer.from('kept'));
    const documents = new PgScholarshipDocumentStore(pool);
    const service = new ScholarshipDocumentService({
      documents,
      blobs,
      scholarshipService: {} as ScholarshipService,
    });

    expect(await documents.listTenantIdsForRetention()).toContain(fx.tenantId);
    const result = await service.purgeExpiredDocuments(fx.tenantId);
    expect(result).toEqual({ purged: 1, failures: [] });
    expect(await blobs.get(keyOf(fx.expiredId))).toBeNull();
    expect(await blobs.get(keyOf(fx.keptId))).not.toBeNull();

    const rows = await withPgTenant(pool, fx.tenantId, (client) =>
      client.query(
        `SELECT id, retention_until FROM scholarship_application_documents WHERE tenant_id = $1`,
        [fx.tenantId],
      ),
    );
    expect(rows.rows.map((r) => (r as { id: string }).id)).toEqual([fx.keptId]);
    const audit = await withPgTenant(pool, fx.tenantId, (client) =>
      client.query(
        `SELECT operation FROM audit_log_entries
          WHERE tenant_id = $1 AND entity_id = $2`,
        [fx.tenantId, fx.expiredId],
      ),
    );
    expect(audit.rows.map((r) => (r as { operation: string }).operation)).toEqual(['DELETE']);
  });

  it('refuses to delete an application that still has documents (319 RESTRICT)', async () => {
    const fx = await seed();
    await expect(
      withPgTenant(pool, fx.tenantId, (client) =>
        client.query(`DELETE FROM scholarship_applications WHERE id = $1`, [fx.applicationId]),
      ),
    ).rejects.toMatchObject({ code: '23503' });
    const left = await withPgTenant(pool, fx.tenantId, (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM scholarship_application_documents WHERE application_id = $1`,
        [fx.applicationId],
      ),
    );
    expect((left.rows[0] as { n: number }).n).toBe(2);
  });
});
