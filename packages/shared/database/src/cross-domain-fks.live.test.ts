/**
 * W1-DATA-15 complete residual — live Postgres proofs that orphan cross-domain
 * UUID inserts are denied by 076 / 078 NOT VALID FKs.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const DATABASE_URL = requireLiveDatabaseUrl({
  suite: 'cross-domain-fks.live.test',
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe.skipIf(!DATABASE_URL)('W1-DATA-15 cross-domain FK orphan deny (live)', () => {
  let pool: pg.Pool;
  let tenantId: string;
  let hasStaffContracts: boolean;
  let hasStudentAttendance: boolean;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    // Ensure complete-residual migrations are present (idempotent).
    for (const file of [
      '085_cross_domain_fk_staff_ops.sql',
      '086_validate_cross_domain_fk_staff_ops.sql',
      '087_cross_domain_fk_prisma_not_valid.sql',
    ]) {
      const sql = readFileSync(path.join(ROOT, 'db/sql', file), 'utf8');
      await pool.query(sql);
    }

    const staffTbl = await pool.query(
      `SELECT to_regclass('public.staff_contracts') IS NOT NULL AS ok`,
    );
    hasStaffContracts = Boolean(staffTbl.rows[0]?.ok);
    const attTbl = await pool.query(
      `SELECT to_regclass('public.student_attendance') IS NOT NULL AS ok`,
    );
    hasStudentAttendance = Boolean(attTbl.rows[0]?.ok);

    tenantId = randomUUID();
    const client = await pool.connect();
    try {
      await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
      await client.query(
        `INSERT INTO tenants (id, name, slug, status) VALUES ($1, $2, $3, 'active')
         ON CONFLICT (id) DO NOTHING`,
        [tenantId, `fk-complete-${tenantId.slice(0, 8)}`, `fk-complete-${tenantId.slice(0, 8)}`],
      );
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it('denies orphan staff_id insert on staff_contracts (076)', async () => {
    if (!hasStaffContracts) {
      console.warn('staff_contracts missing — skip staff orphan deny');
      return;
    }
    const client = await pool.connect();
    try {
      await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const orphanStaff = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      await expect(
        client.query(
          `INSERT INTO staff_contracts (
             id, tenant_id, staff_id, contract_type, start_date, salary_band, status
           ) VALUES ($1, $2, $3, 'permanent', CURRENT_DATE, 'A', 'active')`,
          [randomUUID(), tenantId, orphanStaff],
        ),
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'staff_contracts_staff_id_fkey',
      });
    } finally {
      client.release();
    }
  });

  it('denies orphan student_id insert on student_attendance (078 NOT VALID)', async () => {
    if (!hasStudentAttendance) {
      console.warn('student_attendance missing — skip prisma orphan deny');
      return;
    }
    const client = await pool.connect();
    try {
      await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantId]);
      const orphanStudent = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      await expect(
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
      ).rejects.toMatchObject({
        code: '23503',
        constraint: 'student_attendance_student_id_fkey',
      });
    } finally {
      client.release();
    }
  });
});
