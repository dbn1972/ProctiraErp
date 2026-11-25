/**
 * PRC-M204 live proof: the database enforces dual control and PII purge on
 * privacy erasure / correction requests (db/sql/315).
 *
 * - A request approved by its own requester is rejected (CHECK 23514), even
 *   when the write bypasses PrivacyService.
 * - approved_by is stamped by the database from the reviewer at approval and
 *   survives later transitions that overwrite reviewed_by.
 * - A terminal correction (rejected / cancelled / applied) cannot keep raw
 *   values; the PG repository persists the service's redaction.
 *
 * Writes run as the runtime role bound to a fresh tenant, inside transactions
 * that are rolled back unless the test needs the row afterwards.
 *
 * Skipped unless DATABASE_URL and MIGRATOR_DATABASE_URL are both set.
 */
import { randomUUID } from 'node:crypto';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { PgPrivacyRepository } from './pg-privacy-repository.js';
import { RecordingPrivacyAuditPort } from './privacy-audit.js';
import { PrivacyService } from './privacy-service.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'privacy-request-dual-control.live.test' });
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

type Outcome = { ok: true; rows: Array<Record<string, unknown>> } | { ok: false; code: string };

/** Runs the statements in order as the runtime role bound to `tenantId`, then rolls back. */
async function inTenant(
  tenantId: string,
  statements: Array<[string, unknown[]]>,
): Promise<Outcome> {
  const client = await runtimePool!.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_app_tenant_id($1)`, [tenantId]);
    let rows: Array<Record<string, unknown>> = [];
    for (const [sql, params] of statements) {
      try {
        rows = (await client.query(sql, params)).rows as Array<Record<string, unknown>>;
      } catch (err) {
        return { ok: false, code: String((err as { code?: string }).code) };
      }
    }
    return { ok: true, rows };
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

async function tenant(): Promise<string> {
  const tenantId = randomUUID();
  await ensurePgTestTenant(ownerPool!, tenantId);
  return tenantId;
}

const insertErasure = (id: string, tenantId: string, requestedBy: string): [string, unknown[]] => [
  `INSERT INTO privacy_erasure_requests (id, tenant_id, subject_type, subject_id, status, requested_by)
   VALUES ($1, $2, 'student', 'stu-1', 'under_review', $3)`,
  [id, tenantId, requestedBy],
];

const insertCorrection = (
  id: string,
  tenantId: string,
  requestedBy: string,
): [string, unknown[]] => [
  `INSERT INTO privacy_correction_requests
     (id, tenant_id, subject_type, subject_id, field_path, current_value, requested_value, status, requested_by)
   VALUES ($1, $2, 'student', 'stu-1', 'first_name', 'Old Name', 'New Name', 'under_review', $3)`,
  [id, tenantId, requestedBy],
];

describe.skipIf(!live)('PRC-M204 privacy request dual control (live Postgres)', () => {
  it('rejects an erasure request approved by its own requester', async () => {
    const tenantId = await tenant();
    const id = randomUUID();
    const res = await inTenant(tenantId, [
      insertErasure(id, tenantId, 'dpo-1'),
      [
        `UPDATE privacy_erasure_requests SET status = 'approved', reviewed_by = 'dpo-1' WHERE id = $1`,
        [id],
      ],
    ]);
    expect(res).toEqual({ ok: false, code: '23514' });
  });

  it('rejects a correction request approved by its own requester', async () => {
    const tenantId = await tenant();
    const id = randomUUID();
    const res = await inTenant(tenantId, [
      insertCorrection(id, tenantId, 'clerk-1'),
      [
        `UPDATE privacy_correction_requests SET status = 'approved', reviewed_by = 'clerk-1' WHERE id = $1`,
        [id],
      ],
    ]);
    expect(res).toEqual({ ok: false, code: '23514' });
  });

  it('stamps approved_by from the approver and keeps it when execution overwrites reviewed_by', async () => {
    const tenantId = await tenant();
    const id = randomUUID();
    const res = await inTenant(tenantId, [
      insertErasure(id, tenantId, 'dpo-1'),
      [
        `UPDATE privacy_erasure_requests SET status = 'approved', reviewed_by = 'dpo-2' WHERE id = $1`,
        [id],
      ],
      [
        `UPDATE privacy_erasure_requests SET status = 'in_progress', reviewed_by = 'dpo-3' WHERE id = $1`,
        [id],
      ],
      [
        `UPDATE privacy_erasure_requests SET status = 'approved', reviewed_by = 'dpo-1' WHERE id = $1`,
        [id],
      ],
      [`SELECT approved_by, reviewed_by FROM privacy_erasure_requests WHERE id = $1`, [id]],
    ]);
    // The in_progress -> approved retry keeps the original approval (dpo-2).
    expect(res).toEqual({ ok: true, rows: [{ approved_by: 'dpo-2', reviewed_by: 'dpo-1' }] });
  });

  it('a terminal correction cannot keep the raw values', async () => {
    const tenantId = await tenant();
    const id = randomUUID();
    const res = await inTenant(tenantId, [
      insertCorrection(id, tenantId, 'clerk-1'),
      [
        `UPDATE privacy_correction_requests SET status = 'rejected', reviewed_by = 'dpo-2' WHERE id = $1`,
        [id],
      ],
    ]);
    expect(res).toEqual({ ok: false, code: '23514' });
  });

  it('the service redacts a rejected correction and refuses a self-approval (PG repository)', async () => {
    const tenantId = await tenant();
    const service = new PrivacyService(new PgPrivacyRepository(runtimePool!), {
      audit: new RecordingPrivacyAuditPort(),
    });
    const a = await service.createCorrectionRequest({
      tenantId,
      subjectType: 'student',
      subjectId: 'stu-1',
      fieldPath: 'first_name',
      currentValue: 'Old Name',
      requestedValue: 'New Name',
      requestedBy: 'clerk-1',
    });
    await service.transitionCorrectionRequest(a.id, tenantId, 'under_review', 'dpo-2');
    await expect(
      service.transitionCorrectionRequest(a.id, tenantId, 'approved', 'clerk-1'),
    ).rejects.toMatchObject({ statusCode: 409 });
    const rejected = await service.transitionCorrectionRequest(a.id, tenantId, 'rejected', 'dpo-2');
    expect(rejected).toMatchObject({
      status: 'rejected',
      currentValue: null,
      requestedValue: '[REDACTED]',
    });
    const b = await service.createCorrectionRequest({
      tenantId,
      subjectType: 'student',
      subjectId: 'stu-1',
      fieldPath: 'first_name',
      requestedValue: 'Other Name',
      requestedBy: 'clerk-1',
    });
    await service.transitionCorrectionRequest(b.id, tenantId, 'under_review', 'dpo-2');
    const approved = await service.transitionCorrectionRequest(b.id, tenantId, 'approved', 'dpo-2');
    expect(approved).toMatchObject({ status: 'approved', approvedBy: 'dpo-2' });
  });
});
