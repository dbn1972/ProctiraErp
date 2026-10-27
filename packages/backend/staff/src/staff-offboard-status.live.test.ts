/**
 * PRC-M381 — live proof that staff offboarding is one conditional write on
 * first-class columns (db/sql/260), not a read-modify-write of custom_data.
 *
 * Before: two concurrent offboards both pass the "not yet offboarded" check and
 * both write (RED: two successes; no offboard_* columns). After: exactly one
 * succeeds, the other gets ConflictError, the winner's decision is in the
 * offboard_* columns and still mirrored in custom_data.__offboard (GREEN).
 */
import { randomUUID } from 'node:crypto';

import { ConflictError } from '@proctira/common';
import {
  closeSharedPgPools,
  createPrismaClient,
  getSharedPgPool,
  withPgTenant,
} from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, describe, expect, it } from 'vitest';

import { PrismaStaffRepository } from './prisma-staff-repository.js';
import { StaffService } from './staff-service.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'staff-offboard-status.live.test' });

/** Holds the first `parties` findById calls until all of them have read the row. */
class BarrierStaffRepository extends PrismaStaffRepository {
  private waiting: Array<() => void> = [];
  private remaining: number;
  constructor(prisma: ConstructorParameters<typeof PrismaStaffRepository>[0], parties: number) {
    super(prisma);
    this.remaining = parties;
  }
  override async findById(...args: Parameters<PrismaStaffRepository['findById']>) {
    const row = await super.findById(...args);
    if (this.remaining > 0) {
      this.remaining -= 1;
      if (this.remaining === 0) {
        for (const release of this.waiting) release();
        this.waiting = [];
      } else {
        await new Promise<void>((resolve) => this.waiting.push(resolve));
      }
    }
    return row;
  }
}
const pool = DATABASE_URL ? getSharedPgPool() : null;
const live = Boolean(DATABASE_URL) && pool !== null;

describe.skipIf(!live)('staff offboard status (live)', () => {
  const prisma = DATABASE_URL ? createPrismaClient({ datasourceUrl: DATABASE_URL }) : null;

  afterAll(async () => {
    await prisma?.$disconnect();
    await closeSharedPgPools();
  });

  async function newStaff() {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const service = new StaffService(new PrismaStaffRepository(prisma!));
    const staff = await service.create(tenantId, {
      firstName: 'Off',
      lastName: 'Board',
      dateOfBirth: '1980-01-01',
      identityNumber: `OB-${randomUUID().slice(0, 8)}`,
      contactPhone: '+15550000000',
      position: 'Teacher',
    });
    return { tenantId, service, staff };
  }

  it('two concurrent offboards: exactly one succeeds, the other gets ConflictError', async () => {
    const { tenantId, staff } = await newStaff();
    // Deterministic interleaving: both offboards finish their initial read
    // (findById) before either writes — the race the finding describes.
    const service = new StaffService(new BarrierStaffRepository(prisma!, 2));
    const results = await Promise.allSettled([
      service.offboard(tenantId, staff.id, { effectiveDate: '2026-09-30', reason: 'A' }, 'hr-a'),
      service.offboard(tenantId, staff.id, { effectiveDate: '2026-10-31', reason: 'B' }, 'hr-b'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBeInstanceOf(ConflictError);
  });

  it('persists the decision in the offboard_* columns and mirrors custom_data.__offboard', async () => {
    const { tenantId, service, staff } = await newStaff();
    const view = await service.offboard(
      tenantId,
      staff.id,
      { effectiveDate: '2026-09-30', reason: 'End of term' },
      'hr-officer',
    );
    expect(view).toMatchObject({
      offboardStatus: 'offboarded',
      employmentStatus: 'INACTIVE',
      effectiveDate: '2026-09-30',
      reason: 'End of term',
      decidedBy: 'hr-officer',
    });
    const row = await withPgTenant(pool!, tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT offboard_status, offboard_effective_date::text AS effective, offboard_reason,
                offboarded_by, offboarded_at IS NOT NULL AS has_at,
                custom_data -> '__offboard' ->> 'decidedBy' AS json_decided_by
           FROM staff WHERE id = $1`,
        [staff.id],
      );
      return rows[0] as Record<string, unknown>;
    });
    expect(row).toEqual({
      offboard_status: 'offboarded',
      effective: '2026-09-30',
      offboard_reason: 'End of term',
      offboarded_by: 'hr-officer',
      has_at: true,
      json_decided_by: 'hr-officer',
    });
    await expect(service.getOffboardStatus(tenantId, staff.id)).resolves.toMatchObject({
      offboardStatus: 'offboarded',
      decidedBy: 'hr-officer',
      effectiveDate: '2026-09-30',
    });
  });

  it('staff_offboard_status_chk rejects any other offboard_status value', async () => {
    const { tenantId, staff } = await newStaff();
    const error = await withPgTenant(pool!, tenantId, (client) =>
      client.query(`UPDATE staff SET offboard_status = 'pending' WHERE id = $1`, [staff.id]),
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: '23514', constraint: 'staff_offboard_status_chk' });
  });
});
