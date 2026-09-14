import { describe, expect, it } from 'vitest';

import { InMemoryStaffHrStore } from './hr-store.js';
import { StaffHrService } from './hr-service.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import { StaffService } from './staff-service.js';

describe('W1-DATA-07 COMPLETE payroll reverse/replace (no overwrite)', () => {
  it('savePayrollExport refuses a second posted run for the same month', async () => {
    const store = new InMemoryStaffHrStore();
    const base = {
      tenantId: 't1',
      month: '2025-09',
      filename: 'payroll-2025-09.csv',
      csv: 'staffId,netCents\ns1,100\n',
      rowsJson: '[{"staffId":"s1","netCents":100}]',
      trialBalanceJson: '{"debitCents":100,"creditCents":100,"accounts":{}}',
      grossCents: 120,
      deductionsCents: 20,
      netCents: 100,
      createdAt: new Date('2025-09-14T00:00:00.000Z'),
    };
    await store.savePayrollExport({ ...base, runId: 'run-1' });
    await expect(store.savePayrollExport({ ...base, runId: 'run-2' })).rejects.toThrow(
      /reverse and replace/,
    );
  });

  it('reverseAndReplace keeps prior posted row and surfaces the replacement', async () => {
    const store = new InMemoryStaffHrStore();
    const base = {
      tenantId: 't1',
      month: '2025-09',
      filename: 'payroll-2025-09.csv',
      csv: 'v1',
      rowsJson: '[]',
      trialBalanceJson: '{}',
      grossCents: 100,
      deductionsCents: 0,
      netCents: 100,
      createdAt: new Date('2025-09-14T00:00:00.000Z'),
    };
    await store.savePayrollExport({ ...base, runId: 'run-1' });
    const replaced = await store.reverseAndReplacePayrollExport({
      ...base,
      runId: 'run-2',
      csv: 'v2',
      grossCents: 200,
      netCents: 200,
      createdAt: new Date('2025-09-15T00:00:00.000Z'),
    });
    expect(replaced.runId).toBe('run-2');
    expect(replaced.replacesRunId).toBe('run-1');
    expect(replaced.csv).toBe('v2');
    const current = await store.findPayrollExport('t1', '2025-09');
    expect(current?.runId).toBe('run-2');
    expect(current?.csv).toBe('v2');
  });

  it('exportPayroll replace=true yields a new runId without mutating the prior', async () => {
    const store = new InMemoryStaffHrStore();
    const staffService = new StaffService(new InMemoryStaffRepository());
    const hr = new StaffHrService(store, staffService);
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const first = await hr.exportPayroll(tenantId, { month: '2026-09' });
    const second = await hr.exportPayroll(tenantId, { month: '2026-09', replace: true });
    expect(second.idempotent).toBe(false);
    expect(second.runId).not.toBe(first.runId);
    const current = await store.findPayrollExport(tenantId, '2026-09');
    expect(current?.runId).toBe(second.runId);
    expect(current?.replacesRunId).toBe(first.runId);
  });
});
