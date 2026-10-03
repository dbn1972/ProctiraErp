/**
 * Live Postgres proof for PRC-H077: erasing a student pseudonymises the student row, deletes
 * health records and file rows (objects purged via the injected deleter), keeps fees amounts;
 * offboarding purges tenant tables while statutory ledgers are retained.
 *
 * Runs as the non-owner runtime role (RLS enforced). Skipped unless DATABASE_URL is set.
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import { ensurePgTestStudent } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { PgSubjectAnonymizer, PgTenantWipeExecutor } from './pg-domain-erasure.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'pg-domain-erasure.live.test' });
const pool = DATABASE_URL ? new pg.Pool({ connectionString: DATABASE_URL, max: 2 }) : null;
const live = pool !== null;

afterAll(async () => {
  await pool?.end();
});

async function seedStudent(tenantId: string, studentId: string) {
  await ensurePgTestStudent(pool!, tenantId, studentId);
  await withPgTenant(pool!, tenantId, async (client) => {
    await client.query(
      `UPDATE students SET first_name = 'Asha', last_name = 'Rao', national_id = $3
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, studentId, `NID-${studentId.slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO health_allergies (id, tenant_id, student_id, allergy_type, description, severity)
       VALUES ($1, $2, $3, 'food', 'peanut', 'severe')`,
      [randomUUID(), tenantId, studentId],
    );
    await client.query(
      `INSERT INTO student_documents (id, tenant_id, student_id, category, file_name, object_key,
                                      mime_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, 'national_id', 'aadhaar.pdf', $4, 'application/pdf', 10, 'staff-1')`,
      [randomUUID(), tenantId, studentId, `docs/${studentId}/aadhaar.pdf`],
    );
    await client.query(
      `INSERT INTO parent_fee_invoices (id, tenant_id, student_id, title, description,
                                        amount_cents, currency, status)
       VALUES ($1, $2, $3, 'Term 1', 'Tuition', 5000, 'INR', 'open')`,
      [randomUUID(), tenantId, studentId],
    );
  });
}

describe('PgSubjectAnonymizer (live, PRC-H077)', () => {
  it.skipIf(!live)(
    'erases student PII, health and files; retains fees amounts; no residual',
    async () => {
      const tenantId = randomUUID();
      const studentId = randomUUID();
      await seedStudent(tenantId, studentId);
      const deleted: string[] = [];
      const anonymizer = new PgSubjectAnonymizer({
        pool: pool!,
        policy: { financial: 'pseudonymise', health: 'delete' },
        deleteObject: async (key) => {
          deleted.push(key);
        },
      });
      const result = await anonymizer.anonymize({
        tenantId,
        subjectType: 'student',
        subjectId: studentId,
        requestType: 'erasure',
        jobId: randomUUID(),
      } as never);
      expect(result.residualNote).toBeUndefined();
      expect(deleted).toEqual([`docs/${studentId}/aadhaar.pdf`]);
      await withPgTenant(pool!, tenantId, async (client) => {
        const s = await client.query(
          `SELECT first_name, last_name, national_id, deleted_at FROM students WHERE id = $1`,
          [studentId],
        );
        const row = s.rows[0] as Record<string, unknown>;
        expect(row['first_name']).toBe('Erased');
        expect(String(row['last_name'])).toMatch(/^ERASED-/);
        expect(row['national_id']).toBeNull();
        expect(row['deleted_at']).not.toBeNull();
        const h = await client.query(
          `SELECT count(*)::int AS n FROM health_allergies WHERE student_id = $1`,
          [studentId],
        );
        expect((h.rows[0] as { n: number }).n).toBe(0);
        const d = await client.query(
          `SELECT count(*)::int AS n FROM student_documents WHERE student_id = $1`,
          [studentId],
        );
        expect((d.rows[0] as { n: number }).n).toBe(0);
        const f = await client.query(
          `SELECT amount_cents FROM parent_fee_invoices WHERE student_id = $1`,
          [studentId],
        );
        expect((f.rows[0] as { amount_cents: number }).amount_cents).toBe(5000);
      });
    },
  );

  it.skipIf(!live)('reports a residual when file objects cannot be purged', async () => {
    const tenantId = randomUUID();
    const studentId = randomUUID();
    await seedStudent(tenantId, studentId);
    const result = await new PgSubjectAnonymizer({ pool: pool! }).anonymize({
      tenantId,
      subjectType: 'student',
      subjectId: studentId,
      requestType: 'erasure',
      jobId: randomUUID(),
    } as never);
    expect(result.residualNote).toMatch(/file object/);
  });

  it.skipIf(!live)("never touches another tenant's student", async () => {
    const tenantA = randomUUID();
    const tenantB = randomUUID();
    const studentB = randomUUID();
    await seedStudent(tenantB, studentB);
    await expect(
      new PgSubjectAnonymizer({ pool: pool!, deleteObject: async () => undefined }).anonymize({
        tenantId: tenantA,
        subjectType: 'student',
        subjectId: studentB,
        requestType: 'erasure',
        jobId: randomUUID(),
      } as never),
    ).rejects.toThrow(/not found/);
    await withPgTenant(pool!, tenantB, async (client) => {
      const s = await client.query(`SELECT first_name FROM students WHERE id = $1`, [studentB]);
      expect((s.rows[0] as { first_name: string }).first_name).toBe('Asha');
    });
  });
});

describe('PgTenantWipeExecutor (live, PRC-H077)', () => {
  it.skipIf(!live)(
    'purges tenant tables, pseudonymises ledger-referenced students, retains invoices',
    async () => {
      const tenantId = randomUUID();
      const studentId = randomUUID();
      await seedStudent(tenantId, studentId);
      const results = await new PgTenantWipeExecutor({ pool: pool! }).wipe({
        tenantId,
        jobId: randomUUID(),
        reason: 'contract ended',
      });
      expect(results.find((r) => r.domain === 'tenant_tables')?.status).toBe('completed');
      await withPgTenant(pool!, tenantId, async (client) => {
        const h = await client.query(`SELECT count(*)::int AS n FROM health_allergies`);
        expect((h.rows[0] as { n: number }).n).toBe(0);
        const inv = await client.query(`SELECT count(*)::int AS n FROM parent_fee_invoices`);
        expect((inv.rows[0] as { n: number }).n).toBe(1);
        const s = await client.query(`SELECT first_name FROM students`);
        for (const row of s.rows as Array<{ first_name: string }>) {
          expect(row.first_name).toBe('Erased');
        }
      });
    },
  );
});
