/**
 * PRC-M198 residual — live proof for db/sql/244 and 261 SIS range CHECKs.
 *
 * 244: grade_entries.numeric_score 0..100 and academic_periods end >= start
 * must be VALIDATED. 261: classes.capacity >= 1 and grades."order" >= 0,
 * mirroring the TypeBox ranges in institution class/grade schemas.
 * Before 261 an out-of-range class capacity / grade order is accepted (RED);
 * after, it is rejected with 23514 while an in-range write still succeeds
 * (GREEN). Probes run as the runtime role and are always rolled back.
 */
import { randomUUID } from 'node:crypto';

import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withPgTenant } from './pg-tenant.js';
import { bindTenantGuc } from './tenant-guc.js';
import { ensurePgTestTenant } from './test-fixtures.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'sis-range-checks-residual.live.test' });

describe.skipIf(!DATABASE_URL)('SIS range CHECKs residual (live)', () => {
  let pool: pg.Pool;
  const tenantId = randomUUID();
  const institutionId = randomUUID();
  const periodId = randomUUID();
  const gradeId = randomUUID();

  async function probe(sql: string, params: unknown[]): Promise<unknown> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await bindTenantGuc(client, tenantId);
      try {
        await client.query(sql, params);
        return null;
      } catch (error) {
        return error;
      }
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    await ensurePgTestTenant(pool, tenantId);
    const suffix = tenantId.slice(0, 8);
    const areaId = randomUUID();
    await withPgTenant(pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO geographic_areas (id, tenant_id, name, code, level, parent_id, path, lft, rgt)
         VALUES ($1, $2, 'Root', 'ROOT', 0, NULL, '/', 1, 2)`,
        [areaId, tenantId],
      );
      await client.query(
        `INSERT INTO institutions (id, tenant_id, name, code, area_id, type, sector, ownership, status)
         VALUES ($1, $2, 'Range School', $3, $4, 'SCHOOL', 'PUBLIC', 'GOVERNMENT', 'active')`,
        [institutionId, tenantId, `RNG-${suffix}`, areaId],
      );
      await client.query(
        `INSERT INTO academic_periods (id, tenant_id, name, code, start_date, end_date, status)
         VALUES ($1, $2, 'AY', $3, '2026-04-01', '2027-03-31', 'active')`,
        [periodId, tenantId, `AY-${suffix}`],
      );
      await client.query(
        `INSERT INTO grades (id, tenant_id, name, code, "order") VALUES ($1, $2, 'G1', $3, 1)`,
        [gradeId, tenantId, `G1-${suffix}`],
      );
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('244 and 261 range CHECKs are present and validated', async () => {
    const { rows } = await pool.query<{ conname: string; convalidated: boolean }>(
      `SELECT conname, convalidated FROM pg_constraint
        WHERE contype = 'c' AND conname = ANY ($1::text[]) ORDER BY conname`,
      [
        [
          'academic_periods_date_range_chk',
          'classes_capacity_range_chk',
          'grade_entries_numeric_score_range_chk',
          'grades_order_range_chk',
        ],
      ],
    );
    expect(rows).toEqual([
      { conname: 'academic_periods_date_range_chk', convalidated: true },
      { conname: 'classes_capacity_range_chk', convalidated: true },
      { conname: 'grade_entries_numeric_score_range_chk', convalidated: true },
      { conname: 'grades_order_range_chk', convalidated: true },
    ]);
  });

  it('classes.capacity below 1 is rejected; 1 and NULL are accepted', async () => {
    const sql = `INSERT INTO classes (id, tenant_id, institution_id, grade_id, academic_period_id, name, capacity)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`;
    const params = (capacity: number | null) => [
      randomUUID(),
      tenantId,
      institutionId,
      gradeId,
      periodId,
      `C-${randomUUID().slice(0, 6)}`,
      capacity,
    ];
    expect(await probe(sql, params(1))).toBeNull();
    expect(await probe(sql, params(null))).toBeNull();
    expect(await probe(sql, params(0))).toMatchObject({
      code: '23514',
      constraint: 'classes_capacity_range_chk',
    });
  });

  it('grades."order" below 0 is rejected; 0 is accepted', async () => {
    const sql = `INSERT INTO grades (id, tenant_id, name, code, "order") VALUES ($1, $2, 'G', $3, $4)`;
    const params = (order: number) => [
      randomUUID(),
      tenantId,
      `G-${randomUUID().slice(0, 6)}`,
      order,
    ];
    expect(await probe(sql, params(0))).toBeNull();
    expect(await probe(sql, params(-1))).toMatchObject({
      code: '23514',
      constraint: 'grades_order_range_chk',
    });
  });
});
