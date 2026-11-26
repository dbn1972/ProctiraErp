/**
 * PRC-M197 — live Postgres proof for the scholarship slot, duplicate
 * application and disbursement-amount constraints and the INR default
 * (db/sql/326 + 327).
 *
 * Before: currency defaulted to USD, used_slots could exceed total_slots, a
 * disbursement's amount and amount_cents could disagree, and an applicant
 * could hold two live applications to one programme. After: INR default,
 * 23514 for the two CHECKs, 23505 (mapped to 409 ConflictError by the
 * repository) for a second live application, and the service refuses a
 * programme edit that lowers total_slots below used_slots.
 *
 * Requires DATABASE_URL as proctira_app against a DB migrated through 327.
 */
import { randomUUID } from 'node:crypto';
import { ConflictError } from '@proctira/common';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPgScholarshipEnabled } from './create-scholarship-repository.js';
import { PgScholarshipRepository } from './pg-scholarship-repository.js';
import { ScholarshipService } from './scholarship-service.js';

const DATABASE_URL = process.env['DATABASE_URL'];
const live = isPgScholarshipEnabled();

describe.skipIf(!live)('PRC-M197 scholarship constraints (live)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function withProgram(
    fn: (c: pg.PoolClient, ids: { tenantId: string; programId: string }) => Promise<void>,
    usedSlots = 0,
  ) {
    const tenantId = randomUUID();
    const programId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await client.query(
        `INSERT INTO scholarship_programs (
           id, tenant_id, name, application_start_date, application_end_date, total_slots,
           used_slots, amount_per_recipient, amount_per_recipient_cents, status
         ) VALUES ($1, $2, 'M197 programme', DATE '2026-01-01', DATE '2026-12-31', 2,
                   $3, 500, 50000, 'open')`,
        [programId, tenantId, usedSlots],
      );
      await fn(client, { tenantId, programId });
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  function apply(c: pg.PoolClient, tenantId: string, programId: string, applicantId: string) {
    const id = randomUUID();
    return c
      .query(
        `INSERT INTO scholarship_applications (
           id, tenant_id, program_id, applicant_id, institution_id, status
         ) VALUES ($1, $2, $3, $4, $5, 'submitted')`,
        [id, tenantId, programId, applicantId, randomUUID()],
      )
      .then(() => id);
  }

  it('defaults a programme currency to INR', async () => {
    await withProgram(async (c, { programId }) => {
      const { rows } = await c.query(`SELECT currency FROM scholarship_programs WHERE id = $1`, [
        programId,
      ]);
      expect(rows[0]).toEqual({ currency: 'INR' });
    });
  });

  it('refuses used_slots above total_slots', async () => {
    await withProgram(async (c, { programId }) => {
      await c.query('SAVEPOINT s1');
      await expect(
        c.query(`UPDATE scholarship_programs SET used_slots = 3 WHERE id = $1`, [programId]),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'scholarship_programs_used_slots_within_total_chk',
      });
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expect(
        c.query(`UPDATE scholarship_programs SET total_slots = 1 WHERE id = $1`, [programId]),
      ).resolves.toMatchObject({ rowCount: 1 });
    });
  });

  it('refuses a disbursement whose amount and cents disagree', async () => {
    await withProgram(async (c, { tenantId, programId }) => {
      const applicationId = await apply(c, tenantId, programId, randomUUID());
      const disburse = (amount: string, cents: number) =>
        c.query(
          `INSERT INTO scholarship_disbursements (
             id, tenant_id, application_id, amount, amount_cents, scheduled_date
           ) VALUES ($1, $2, $3, $4::numeric, $5, CURRENT_DATE)`,
          [randomUUID(), tenantId, applicationId, amount, cents],
        );
      await c.query('SAVEPOINT s1');
      await expect(disburse('500', 0)).rejects.toMatchObject({
        code: '23514',
        constraint: 'scholarship_disbursements_amount_cents_consistent_chk',
      });
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await disburse('500.25', 50025);
    });
  });

  it('allows one live application per applicant and programme', async () => {
    await withProgram(async (c, { tenantId, programId }) => {
      const applicantId = randomUUID();
      const first = await apply(c, tenantId, programId, applicantId);
      await c.query('SAVEPOINT s1');
      await expect(apply(c, tenantId, programId, applicantId)).rejects.toMatchObject({
        code: '23505',
        constraint: 'scholarship_applications_one_live_uidx',
      });
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await c.query(`UPDATE scholarship_applications SET status = 'withdrawn' WHERE id = $1`, [
        first,
      ]);
      await apply(c, tenantId, programId, applicantId);
    });
  });

  it('maps a duplicate live application to ConflictError in the repository', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool, tenantId);
    const repo = new PgScholarshipRepository(pool);
    const program = await repo.createProgram({
      id: randomUUID(),
      tenantId,
      name: 'M197 repo programme',
      description: null,
      applicationStartDate: '2026-01-01',
      applicationEndDate: '2026-12-31',
      totalSlots: 3,
      usedSlots: 0,
      amountPerRecipient: 100,
      amountPerRecipientCents: 10000,
      currency: 'INR',
      disbursementFrequency: 'one_time',
      eligibility: {},
      status: 'open',
      academicPeriodId: null,
      fundingSourceId: null,
    });
    const application = {
      tenantId,
      programId: program.id,
      applicantId: randomUUID(),
      institutionId: randomUUID(),
      status: 'submitted' as const,
      academicRecords: [],
      financialInfo: {},
      documents: [],
      personalStatement: null,
      areaId: null,
      gender: null,
      workflowInstanceId: null,
      submittedAt: new Date(),
      reviewedAt: null,
    };
    await repo.createApplication({ ...application, id: randomUUID() });
    await expect(
      repo.createApplication({ ...application, id: randomUUID() }),
    ).rejects.toBeInstanceOf(ConflictError);

    const service = new ScholarshipService(repo);
    await repo.updateProgram(program.id, tenantId, { usedSlots: 2 });
    await expect(
      service.updateProgram(tenantId, program.id, { totalSlots: 1 }),
    ).rejects.toBeInstanceOf(ConflictError);
    const updated = await service.updateProgram(tenantId, program.id, { totalSlots: 2 });
    expect(updated.totalSlots).toBe(2);
  });
});
