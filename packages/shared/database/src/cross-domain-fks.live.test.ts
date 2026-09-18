/**
 * W1-DATA-15 complete residual — live Postgres proofs that orphan cross-domain
 * UUID inserts are denied by 076 / 078 NOT VALID FKs.
 */
import { randomUUID } from 'node:crypto';

import { withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'cross-domain-fks.live.test',
});

describe.skipIf(!DATABASE_URL)('W1-DATA-15 cross-domain FK orphan deny (live)', () => {
  let pool: pg.Pool;
  let tenantId: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    const { rows } = await pool.query<{ conname: string }>(`
      SELECT conname
        FROM pg_constraint
       WHERE conname IN (
         'staff_contracts_staff_id_fkey',
         'student_attendance_student_id_fkey'
       )
    `);
    expect(new Set(rows.map((row) => row.conname))).toEqual(
      new Set(['staff_contracts_staff_id_fkey', 'student_attendance_student_id_fkey']),
    );

    tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('denies orphan staff_id insert on staff_contracts (076)', async () => {
    const orphanStaff = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await expect(
      withPgTenant(pool, tenantId, (client) =>
        client.query(
          `INSERT INTO staff_contracts (
             id, tenant_id, staff_id, contract_type, start_date, salary_band, status
           ) VALUES ($1, $2, $3, 'permanent', CURRENT_DATE, 'A', 'active')`,
          [randomUUID(), tenantId, orphanStaff],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'staff_contracts_staff_id_fkey',
    });
  });

  it('denies orphan student_id insert on student_attendance (078 NOT VALID)', async () => {
    const orphanStudent = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await expect(
      withPgTenant(pool, tenantId, (client) =>
        client.query(
          `INSERT INTO student_attendance (
             id, tenant_id, student_id, institution_id, class_id, academic_period_id,
             date, status, recorded_by
           ) VALUES (
             $1, $2, $3, $4, $5, $6, CURRENT_DATE, 'PRESENT', $7
           )`,
          [
            randomUUID(),
            tenantId,
            orphanStudent,
            randomUUID(),
            randomUUID(),
            randomUUID(),
            randomUUID(),
          ],
        ),
      ),
    ).rejects.toMatchObject({
      code: '23503',
      constraint: 'student_attendance_student_id_fkey',
    });
  });
});
