/**
 * PRC-M368 live proof: two concurrent payroll posts for the same tenant+month
 * through PgStaffHrStore. Both pass the read pre-check; the 246 partial unique
 * index rejects the loser with 23505, which must surface as the typed 409
 * conflict (not a raw pg error / 500). Exactly one posted row remains.
 * Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';
import { closeSharedPgPools, getSharedPgPool } from '@proctira/database';
import { ensurePgTestTenant } from '@proctira/database/test-fixtures';
import { requireLiveDatabaseUrl } from '@proctira/testing/live-database';
import { afterAll, describe, expect, it } from 'vitest';

import { PayrollRunAlreadyPostedError, type StaffPayrollExportRecord } from './hr-store.js';
import { PgStaffHrStore } from './pg-hr-ops-store.js';

const DATABASE_URL = requireLiveDatabaseUrl({ suite: 'payroll-concurrent-post.live.test' });
const pool = DATABASE_URL ? getSharedPgPool() : null;
const live = Boolean(DATABASE_URL) && pool !== null;

function record(tenantId: string, month: string): StaffPayrollExportRecord {
  return {
    tenantId,
    month,
    runId: randomUUID(),
    filename: `payroll-${month}.csv`,
    csv: 'staffId\n',
    rowsJson: '[]',
    trialBalanceJson: '{"debitCents":0,"creditCents":0,"accounts":{}}',
    grossCents: 0,
    deductionsCents: 0,
    netCents: 0,
    createdAt: new Date(),
  };
}

describe.skipIf(!live)('PRC-M368 concurrent payroll post (live)', () => {
  afterAll(async () => {
    await closeSharedPgPools();
  });

  it('the loser of two concurrent posts gets PayrollRunAlreadyPostedError (409)', async () => {
    const tenantId = randomUUID();
    await ensurePgTestTenant(pool!, tenantId);
    const store = new PgStaffHrStore(pool!);
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => store.savePayrollExport(record(tenantId, '2026-07'))),
    );
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    for (const r of rejected) {
      expect((r.reason as PayrollRunAlreadyPostedError).statusCode).toBe(409);
      expect(r.reason).toBeInstanceOf(PayrollRunAlreadyPostedError);
    }
    const current = await store.findPayrollExport(tenantId, '2026-07');
    expect(current?.runId).toBe(
      (fulfilled[0] as PromiseFulfilledResult<{ runId: string }>).value.runId,
    );
  });
});
