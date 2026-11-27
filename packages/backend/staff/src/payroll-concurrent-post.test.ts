/**
 * PRC-M368: payroll post is check-then-insert. When a concurrent post for the
 * same tenant+month wins between the check and the insert, the loser must get
 * the winner's run back (idempotent), not a 500, and write no second audit.
 */
import { randomUUID } from 'node:crypto';
import { ConflictError } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { StaffHrService } from './hr-service.js';
import { InMemoryStaffHrStore, type StaffPayrollExportRecord } from './hr-store.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { StaffService } from './staff-service.js';

/** Once armed, the next findPayrollExport misses, as it would for the loser of a race. */
class RacingStore extends InMemoryStaffHrStore {
  missNext = false;
  override async findPayrollExport(tenantId: string, month: string) {
    if (this.missNext) {
      this.missNext = false;
      return null;
    }
    return super.findPayrollExport(tenantId, month);
  }
}

function winnerRecord(tenantId: string, month: string): StaffPayrollExportRecord {
  return {
    tenantId,
    month,
    runId: 'winner-run',
    filename: `payroll-${month}.csv`,
    csv: 'staffId\n',
    rowsJson: '[]',
    trialBalanceJson: JSON.stringify({
      debitCents: 0,
      creditCents: 0,
      accounts: { salary_expense: 0, payroll_deductions: 0, wages_payable: 0 },
    }),
    grossCents: 0,
    deductionsCents: 0,
    netCents: 0,
    createdAt: new Date(),
  };
}

describe('PRC-M368 concurrent payroll post', () => {
  it('store refuses a second posted run with a 409 ConflictError', async () => {
    const store = new InMemoryStaffHrStore();
    const tenantId = randomUUID();
    await store.savePayrollExport(winnerRecord(tenantId, '2026-09'));
    const second = store.savePayrollExport({ ...winnerRecord(tenantId, '2026-09'), runId: 'x' });
    await expect(second).rejects.toBeInstanceOf(ConflictError);
    await expect(second).rejects.toMatchObject({ statusCode: 409 });
  });

  it('the race loser returns the winner run as idempotent and writes no audit', async () => {
    const tenantId = randomUUID();
    const store = new RacingStore();
    const audits: unknown[] = [];
    const hr = new StaffHrService(store, new StaffService(new InMemoryStaffRepository()), {
      auditSink: async (entry) => {
        audits.push(entry);
      },
    });
    // The winner's row is committed, but the loser's pre-check ran before it.
    await store.savePayrollExport(winnerRecord(tenantId, '2026-09'));
    store.missNext = true;
    const result = await hr.exportPayroll(tenantId, { month: '2026-09' }, 'hr-1');
    expect(result.idempotent).toBe(true);
    expect(result.runId).toBe('winner-run');
    expect(audits).toHaveLength(0);
  });
});
