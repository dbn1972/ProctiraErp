/**
 * PRC-L321 — live Postgres proof for AcademicPeriodService.supersede through the
 * tenant-bound Prisma client under FORCE RLS:
 *  - the successor has version = prior + 1 and supersedes_id = prior.id;
 *  - the prior version is closed (archived) with its dates untouched;
 *  - an UPDATE of the prior row's dates is rejected by the database
 *    (db/sql/083 academic_periods_dates_immutable), so a period window can only be
 *    corrected by superseding.
 *
 * Skips cleanly when DATABASE_URL is unset.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient, getSharedPgPool, withPgTenant } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, describe, expect, it } from 'vitest';

import { createTenantBoundPrisma } from '../tenant-bound-prisma.js';
import { tenantContext } from '../tenant-context.js';
import { AcademicPeriodService } from './academic-period-service.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'academic-period-supersede.live.test' });

describe.skipIf(!DATABASE_URL)('PRC-L321 AcademicPeriodService.supersede (live Postgres)', () => {
  const prisma = DATABASE_URL ? createPrismaClient({ datasourceUrl: DATABASE_URL }) : null;
  const pool = DATABASE_URL ? getSharedPgPool(DATABASE_URL) : null;
  const tenantId = randomUUID();

  function withTenant<T>(fn: () => Promise<T>): Promise<T> {
    return tenantContext.run({ tenantId }, fn);
  }

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('appends a versioned successor, archives the prior, and the DB rejects prior date edits', async () => {
    await ensurePgTestTenant(pool!, tenantId);
    const service = new AcademicPeriodService({ prisma: createTenantBoundPrisma(prisma!) });
    const code = `AY-${Date.now().toString(36)}`;

    const prior = await withTenant(() =>
      service.create(tenantId, {
        name: `Live ${code}`,
        code,
        startDate: '2030-04-01',
        endDate: '2031-03-31',
      }),
    );
    const successor = await withTenant(() =>
      service.supersede(tenantId, prior.id, {
        name: `Live ${code} (corrected)`,
        code,
        startDate: '2031-04-01',
        endDate: '2032-03-31',
      }),
    );

    const rows = await withPgTenant(pool!, tenantId, async (client) => {
      const result = await client.query(
        `SELECT id, version, supersedes_id, status, start_date::text AS start_date,
                end_date::text AS end_date
           FROM academic_periods
          WHERE tenant_id = $1::uuid AND id = ANY($2::uuid[])`,
        [tenantId, [prior.id, successor.id]],
      );
      return result.rows as Array<{
        id: string;
        version: number;
        supersedes_id: string | null;
        status: string;
        start_date: string;
        end_date: string;
      }>;
    });
    const priorRow = rows.find((r) => r.id === prior.id)!;
    const successorRow = rows.find((r) => r.id === successor.id)!;

    expect(Number(successorRow.version)).toBe(Number(priorRow.version) + 1);
    expect(successorRow.supersedes_id).toBe(prior.id);
    expect(successorRow.status).toBe('active');
    expect(priorRow.status).toBe('archived');
    expect(priorRow.start_date).toBe('2030-04-01');
    expect(priorRow.end_date).toBe('2031-03-31');

    await expect(
      withPgTenant(pool!, tenantId, (client) =>
        client.query(
          `UPDATE academic_periods SET start_date = '2030-05-01'::date, end_date = '2031-04-30'::date
            WHERE tenant_id = $1::uuid AND id = $2::uuid`,
          [tenantId, prior.id],
        ),
      ),
    ).rejects.toThrow(/immutable/i);

    const after = await withPgTenant(pool!, tenantId, (client) =>
      client.query(
        `SELECT start_date::text AS start_date FROM academic_periods
          WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, prior.id],
      ),
    );
    expect((after.rows[0] as { start_date: string }).start_date).toBe('2030-04-01');
  });
});
