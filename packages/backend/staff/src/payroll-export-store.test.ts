import { describe, expect, it } from 'vitest';
import { InMemoryStaffHrStore } from './hr-store.js';

describe('W1-DATA-07 payroll export durability', () => {
  it('round-trips payroll export through the HR store', async () => {
    const store = new InMemoryStaffHrStore();
    const saved = await store.savePayrollExport({
      tenantId: 't1',
      month: '2025-09',
      runId: 'run-1',
      filename: 'payroll-2025-09.csv',
      csv: 'staffId,netCents\ns1,100\n',
      rowsJson: '[{"staffId":"s1","netCents":100}]',
      trialBalanceJson: '{"debitCents":100,"creditCents":100,"accounts":{}}',
      grossCents: 120,
      deductionsCents: 20,
      netCents: 100,
      createdAt: new Date('2025-09-14T00:00:00.000Z'),
    });
    expect(saved.runId).toBe('run-1');
    const loaded = await store.findPayrollExport('t1', '2025-09');
    expect(loaded?.csv).toContain('s1,100');
    expect(loaded?.grossCents).toBe(120);
  });
});
